// =============================================================================
// FireISP 5.0 — Credit note → CFDI de Egreso conversion tests
// =============================================================================
// stampCreditNote: fiscal preconditions (stampable status, MXN, related vigente
// ingreso REQUIRED, single-CFDI-per-note), tipo E + serie egreso + PUE + G02
// derivation, forma_pago from the related CFDI (or '15' for PPD originals),
// cfdi_related_documents persistence (TipoRelacion 01), synthetic concepto for
// item-less (refund-created) notes, per-line IVA with last-line reconciliation,
// and the created-but-not-stamped (retryable PAC failure) contract.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/cfdiService', () => ({
  getEmisorProfile: jest.fn(),
  generateXml: jest.fn().mockResolvedValue({ xml: '<xml/>' }),
  stamp: jest.fn(),
}));

const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');
const creditNoteCfdiService = require('../src/services/creditNoteCfdiService');

const CN = {
  id: 30, client_id: 7, invoice_id: 60, credit_note_number: 'CN-0030',
  status: 'issued', currency: 'MXN', subtotal: '200.00', tax_rate: '0.1600',
  tax_amount: '32.00', total: '232.00', notes: 'Ajuste por falla de servicio',
  tax_exempt: 0,
};
const EMISOR = { rfc: 'EKU9003173C9', razon_social: 'Escuela Kemper', regimen_fiscal: '601', codigo_postal_fiscal: '26015', cfdi_serie_ingreso: 'A', cfdi_serie_egreso: 'NC' };
const RECEPTOR = { rfc: 'MISC491214B86', razon_social: 'CECILIA MIRANDA SANCHEZ', regimen_fiscal: '612', codigo_postal_fiscal: '01010', uso_cfdi_default: null };
const RELATED_CFDI = { id: 900, uuid: 'AAAA1111-2222-3333-4444-555566667777', forma_pago: '03' };
const ITEMS = [
  { id: 1, credit_note_id: 30, description: 'Crédito servicio', quantity: '1.00', unit_price: '150.00' },
  { id: 2, credit_note_id: 30, description: 'Crédito instalación', quantity: '1.00', unit_price: '50.00' },
];

function makeConn() {
  const conn = {
    executed: [],
    async beginTransaction() {},
    async execute(sql, params) {
      conn.executed.push([sql, params]);
      if (sql.includes('INSERT INTO cfdi_documents')) return [{ insertId: 950 }];
      if (sql.includes('INSERT INTO cfdi_conceptos')) return [{ insertId: 2000 + conn.executed.length }];
      // The authoritative re-read runs the SAME selects on this connection
      // after the row lock — delegate them to the suite's db.query dispatcher
      // so one set of fixtures serves both channels instead of drifting.
      if (/^\s*SELECT/i.test(sql)) return db.query(sql, params);
      return [{ affectedRows: 1 }];
    },
    async query() { return [[{ folio: 77 }]]; },
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return conn;
}

function mockQueries({ cn = CN, existing = [], related = [RELATED_CFDI], receptor = [RECEPTOR], items = ITEMS } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM credit_notes cn/.test(sql)) return [cn ? [{ ...cn }] : []];
    if (/FROM cfdi_documents WHERE credit_note_id/.test(sql)) return [existing];
    if (/FROM cfdi_documents\s+WHERE invoice_id/.test(sql)) return [related];
    if (/FROM client_mx_profiles/.test(sql)) return [receptor.map(r => ({ ...r }))];
    if (/FROM credit_note_items/.test(sql)) return [items.map(i => ({ ...i }))];
    return [[]];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  cfdiService.getEmisorProfile.mockResolvedValue({ ...EMISOR });
  cfdiService.generateXml.mockResolvedValue({ xml: '<xml/>' });
  cfdiService.stamp.mockResolvedValue({ uuid: 'SIM-egreso', status: 'vigente' });
  mockQueries();
  db.getConnection.mockResolvedValue(makeConn());
});

describe('stampCreditNote — preconditions', () => {
  test('404 when the credit note does not exist in this org', async () => {
    mockQueries({ cn: null });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects a draft credit note (422 CREDIT_NOTE_NOT_STAMPABLE)', async () => {
    mockQueries({ cn: { ...CN, status: 'draft' } });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CREDIT_NOTE_NOT_STAMPABLE' });
  });

  test('rejects a cancelled credit note', async () => {
    mockQueries({ cn: { ...CN, status: 'cancelled' } });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CREDIT_NOTE_NOT_STAMPABLE' });
  });

  test('rejects a non-MXN credit note (422 CFDI_UNSUPPORTED_CURRENCY)', async () => {
    mockQueries({ cn: { ...CN, currency: 'USD' } });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CFDI_UNSUPPORTED_CURRENCY' });
  });

  test('rejects when a live CFDI already exists for the note (409 CFDI_EXISTS)', async () => {
    mockQueries({ existing: [{ id: 5, sat_status: 'vigente' }] });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 409, code: 'CFDI_EXISTS' });
  });

  test('rejects a note with no invoice link (422 CFDI_EGRESO_NO_RELATED)', async () => {
    mockQueries({ cn: { ...CN, invoice_id: null } });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CFDI_EGRESO_NO_RELATED' });
  });

  test('rejects when the credited invoice has no vigente CFDI (422 CFDI_EGRESO_NO_RELATED)', async () => {
    mockQueries({ related: [] });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CFDI_EGRESO_NO_RELATED' });
  });

  test('rejects when the client has no MX fiscal profile (422)', async () => {
    mockQueries({ receptor: [] });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CLIENT_MX_PROFILE_MISSING' });
  });

  test('rejects inconsistent header totals (subtotal + tax ≠ total) BEFORE burning a folio', async () => {
    mockQueries({ cn: { ...CN, subtotal: '100.00', tax_amount: '16.00', total: '999.00' } });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CREDIT_NOTE_TOTALS_INCONSISTENT' });
    expect(db.getConnection).not.toHaveBeenCalled(); // no transaction, no folio consumed
  });

  test('rejects when line items do not sum to the subtotal (SAT CFDI40108)', async () => {
    // items sum to 200.00 but the operator-entered subtotal says 500.00
    mockQueries({ cn: { ...CN, subtotal: '500.00', tax_amount: '80.00', total: '580.00' } });
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CREDIT_NOTE_TOTALS_INCONSISTENT' });
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('excludes soft-deleted line items from the conversion query', async () => {
    await creditNoteCfdiService.stampCreditNote(30, 1);
    const itemsCall = db.query.mock.calls.find(([sql]) => /FROM credit_note_items/.test(sql));
    expect(itemsCall[0]).toMatch(/deleted_at IS NULL/);
  });
});

describe('stampCreditNote — conversion', () => {
  test('creates a tipo-E CFDI: serie egreso, PUE, uso G02, forma from the related CFDI', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    const res = await creditNoteCfdiService.stampCreditNote(30, 1);
    expect(res.stamped).toBe(true);
    expect(res.uuid).toBe('SIM-egreso');
    expect(res.serie).toBe('NC');

    const [docSql, docParams] = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    expect(docSql).toMatch(/'E'/);           // tipo_comprobante hardcoded E
    expect(docSql).toMatch(/'PUE'/);         // metodo_pago hardcoded PUE
    expect(docSql).toMatch(/credit_note_id/);
    expect(docSql).not.toMatch(/invoice_id/);
    // [orgId, client_id, creditNoteId, serie, folio, uso, forma, moneda, ...]
    expect(docParams[0]).toBe(1);
    expect(docParams[1]).toBe(7);
    expect(docParams[2]).toBe(30);
    expect(docParams[3]).toBe('NC');
    expect(docParams[5]).toBe('G02');
    expect(docParams[6]).toBe('03');         // concrete forma from the related CFDI
  });

  test('persists the TipoRelacion 01 relation to the credited invoice uuid', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await creditNoteCfdiService.stampCreditNote(30, 1);
    const rel = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_related_documents'));
    expect(rel).toBeTruthy();
    expect(rel[1]).toEqual([950, RELATED_CFDI.uuid, '01']);
  });

  test("a PPD original (forma 99) falls back to forma '15' — PUE cannot carry 99", async () => {
    mockQueries({ related: [{ ...RELATED_CFDI, forma_pago: '99' }] });
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await creditNoteCfdiService.stampCreditNote(30, 1);
    const [, docParams] = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    expect(docParams[6]).toBe('15');
  });

  test('per-line IVA reconciles the LAST line so traslados sum exactly to tax_amount', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await creditNoteCfdiService.stampCreditNote(30, 1);
    const taxInserts = conn.executed.filter(([sql]) => sql.includes('INSERT INTO cfdi_concepto_impuestos'));
    expect(taxInserts).toHaveLength(2);
    const total = taxInserts.reduce((s, [, p]) => s + Number(p[3]), 0); // importe param
    expect(Math.round(total * 100) / 100).toBe(32.00);
  });

  test('an item-less (refund-created) note gets ONE synthetic concepto from the header', async () => {
    mockQueries({ cn: { ...CN, tax_rate: '0', tax_amount: '0', subtotal: '232.00', total: '232.00' }, items: [] });
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await creditNoteCfdiService.stampCreditNote(30, 1);
    const conceptInserts = conn.executed.filter(([sql]) => sql.includes('INSERT INTO cfdi_conceptos'));
    expect(conceptInserts).toHaveLength(1);
    const [, p] = conceptInserts[0];
    expect(p[3]).toBe(1);            // cantidad
    expect(p[5]).toBe(232);          // valor_unitario = subtotal
    expect(p[6]).toBe(232);          // importe
  });

  test('PAC failure leaves the doc as a retryable draft (stamped:false + stamp_error)', async () => {
    cfdiService.stamp.mockRejectedValue(new Error('PAC down'));
    const res = await creditNoteCfdiService.stampCreditNote(30, 1);
    expect(res.stamped).toBe(false);
    expect(res.sat_status).toBe('draft');
    expect(res.stamp_error).toBe('PAC down');
    expect(res.cfdi_document_id).toBe(950);
  });

  test('concurrent stamper loses on the locked re-check (409 CFDI_EXISTS)', async () => {
    const conn = makeConn();
    const passthrough = conn.execute;
    conn.execute = async (sql, params) => {
      // Only the post-lock existence check sees the winner's row; everything
      // else must still resolve, or this fails on an earlier guard and never
      // reaches the race it is about.
      if (/FROM cfdi_documents WHERE credit_note_id/.test(sql)) {
        conn.executed.push([sql, params]);
        return [[{ id: 5, sat_status: 'vigente' }]];
      }
      return passthrough(sql, params);
    };
    db.getConnection.mockResolvedValue(conn);
    await expect(creditNoteCfdiService.stampCreditNote(30, 1))
      .rejects.toMatchObject({ statusCode: 409, code: 'CFDI_EXISTS' });
    expect(conn.rollback).toHaveBeenCalled();
  });
});

// =============================================================================
// j49 — the egreso is built from what the note says AFTER the lock
// =============================================================================
// Mirror of j48/#585 for credit notes, and this side was more exposed: the
// credit-note editor took NO row lock at all until this change, so the stamper
// was not serialized against it even in principle.
describe('stampCreditNote — an edit committing before the lock is not stamped stale', () => {
  /** First call returns `before`, every later call returns `after`. */
  const shifting = (before, after) => {
    let first = true;
    return () => { const v = first ? before : after; first = false; return v; };
  };

  test('amounts come from the post-lock read, not the pre-flight snapshot', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    const pick = shifting({ ...CN }, { ...CN, subtotal: '100.00', tax_amount: '16.00', total: '116.00' });
    // Header and items shift TOGETHER — a real edit changes both, and the
    // consistency gate would reject a mismatched pair on the pre-flight before
    // the race under test was ever reached.
    const pickItems = shifting(
      ITEMS.map(i => ({ ...i })),
      [{ id: 1, credit_note_id: 30, description: 'Crédito', quantity: '1.00', unit_price: '100.00' }],
    );
    db.query.mockImplementation(async (sql) => {
      if (/FROM credit_notes cn/.test(sql)) return [[pick()]];
      if (/FROM cfdi_documents WHERE credit_note_id/.test(sql)) return [[]];
      if (/FROM cfdi_documents\s+WHERE invoice_id/.test(sql)) return [[{ ...RELATED_CFDI }]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM credit_note_items/.test(sql)) return [pickItems()];
      return [[]];
    });

    await creditNoteCfdiService.stampCreditNote(30, 1);

    const insert = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    const [subtotal, totalImpuestos, total] = insert[1].slice(-3);
    expect(Number(subtotal)).toBe(100);
    expect(Number(totalImpuestos)).toBe(16);
    expect(Number(total)).toBe(116);
    expect(Number(total)).not.toBe(232); // the pre-flight figure
  });

  test('an invoice_id change re-points the RELATED ingreso (TipoRelacion 01)', async () => {
    // The relation IS the fiscal point of an egreso — relating it to the wrong
    // ingreso credits an invoice that was never credited.
    const OTHER_REL = { id: 901, uuid: 'BBBB1111-2222-3333-4444-555566667777', forma_pago: '03' };
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    const pick = shifting({ ...CN }, { ...CN, invoice_id: 61 });
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM credit_notes cn/.test(sql)) return [[pick()]];
      if (/FROM cfdi_documents WHERE credit_note_id/.test(sql)) return [[]];
      if (/FROM cfdi_documents\s+WHERE invoice_id/.test(sql)) {
        return [[params[0] === 61 ? { ...OTHER_REL } : { ...RELATED_CFDI }]];
      }
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM credit_note_items/.test(sql)) return [ITEMS.map(i => ({ ...i }))];
      return [[]];
    });

    await creditNoteCfdiService.stampCreditNote(30, 1);

    const rel = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_related_documents'));
    expect(rel[1]).toContain(OTHER_REL.uuid);
    expect(rel[1]).not.toContain(RELATED_CFDI.uuid);
  });

  test('the re-read runs on the TRANSACTION, after the lock', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);

    await creditNoteCfdiService.stampCreditNote(30, 1);

    const lockAt = conn.executed.findIndex(([sql]) => /FOR UPDATE/.test(sql));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    for (const table of [/FROM credit_notes cn/, /client_mx_profiles/, /credit_note_items/]) {
      expect(conn.executed.findIndex(([sql]) => table.test(sql))).toBeGreaterThan(lockAt);
    }
  });
});
