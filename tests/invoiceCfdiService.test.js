// =============================================================================
// FireISP 5.0 — Invoice → CFDI conversion ("stamp later") tests
// =============================================================================
// stampInvoice: fiscal preconditions, PUE/PPD derivation, SAT-code defaults,
// per-line IVA with last-line rounding reconciliation, atomic folio, and the
// created-but-not-stamped (retryable PAC failure) contract.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
}));
jest.mock('../src/models/Invoice', () => ({ findByIdOrFail: jest.fn() }));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/cfdiService', () => ({
  getEmisorProfile: jest.fn(),
  generateXml: jest.fn().mockResolvedValue({ xml: '<xml/>' }),
  stamp: jest.fn(),
}));

const db = require('../src/config/database');
const { AppError } = require('../src/utils/errors');
const Invoice = require('../src/models/Invoice');
const cfdiService = require('../src/services/cfdiService');
const invoiceCfdiService = require('../src/services/invoiceCfdiService');

const INVOICE = {
  id: 60, organization_id: 1, client_id: 7, invoice_number: 'INV-000060',
  status: 'issued', currency: 'MXN', subtotal: '800.00', tax_amount: '128.00',
  total: '928.00', tax_rate: '0.1600',
};
const EMISOR = { rfc: 'EKU9003173C9', razon_social: 'Escuela Kemper', regimen_fiscal: '601', codigo_postal_fiscal: '26015', cfdi_serie_ingreso: 'A' };
const RECEPTOR = { rfc: 'MISC491214B86', razon_social: 'CECILIA MIRANDA SANCHEZ', regimen_fiscal: '612', codigo_postal_fiscal: '01010', uso_cfdi_default: null };
const ITEMS = [
  { id: 1, description: 'Internet 100M', quantity: '1.00', unit_price: '500.00', amount: '500.00', clave_prod_serv: null, clave_unidad: null },
  { id: 2, description: 'Instalación', quantity: '1.00', unit_price: '300.00', amount: '300.00', clave_prod_serv: '81161500', clave_unidad: 'E48' },
];

function makeConn() {
  const conn = {
    executed: [],
    async beginTransaction() {},
    async execute(sql, params) {
      conn.executed.push([sql, params]);
      if (sql.includes('INSERT INTO cfdi_documents')) return [{ insertId: 900 }];
      if (sql.includes('INSERT INTO cfdi_conceptos')) return [{ insertId: 1000 + conn.executed.length }];
      // The authoritative re-read runs the SAME selects on this connection
      // after the row lock. Delegate them to the suite's db.query dispatcher so
      // one set of fixtures serves both channels — otherwise every test would
      // need a parallel set, and they would drift.
      if (/^\s*SELECT/i.test(sql)) return db.query(sql, params);
      return [{ affectedRows: 1 }];
    },
    async query() { return [[{ folio: 42 }]]; },
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return conn;
}

beforeEach(() => {
  jest.clearAllMocks();
  Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE });
  cfdiService.getEmisorProfile.mockResolvedValue({ ...EMISOR });
  cfdiService.generateXml.mockResolvedValue({ xml: '<xml/>' });
  cfdiService.stamp.mockResolvedValue({ uuid: 'SIM-abc', status: 'vigente' });
  db.query.mockImplementation(async (sql) => {
    if (/FROM cfdi_documents/.test(sql)) return [[]];               // no existing CFDI
    if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
    if (/FROM invoice_items/.test(sql)) return [ITEMS.map(i => ({ ...i }))];
    if (/FROM payment_allocations/.test(sql)) return [[{ sat_forma_pago: '03' }]];
    return [[]];
  });
  db.getConnection.mockResolvedValue(makeConn());
});

describe('stampInvoice — preconditions', () => {
  test('a missing ORG fiscal profile is reported before any client-level problem', async () => {
    // The most common first-run failure: a brand-new MX org whose Organization
    // → Fiscal (SAT) page was never filled in. If the invoice-level pre-flight
    // ran first, the operator would be told to fix the CLIENT profile, fix it,
    // retry, and only then learn the org profile was the real blocker.
    cfdiService.getEmisorProfile.mockRejectedValue(
      new AppError('Organization MX profile missing', 422, 'ORG_MX_PROFILE_MISSING'),
    );
    db.query.mockImplementation(async () => [[]]);  // client profile + items also absent
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ code: 'ORG_MX_PROFILE_MISSING' });
  });

  test('rejects a draft invoice (422 INVOICE_NOT_STAMPABLE)', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE, status: 'draft' });
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'INVOICE_NOT_STAMPABLE' });
  });

  test('rejects when a live CFDI already exists (409 CFDI_EXISTS)', async () => {
    db.query.mockImplementationOnce(async () => [[{ id: 5, sat_status: 'vigente' }]]);
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ statusCode: 409, code: 'CFDI_EXISTS' });
  });

  test('a leftover DRAFT CFDI directs to retry, not re-convert', async () => {
    db.query.mockImplementationOnce(async () => [[{ id: 5, sat_status: 'draft' }]]);
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ statusCode: 409, code: 'CFDI_EXISTS' });
  });

  test('rejects when the client has no MX fiscal profile (422)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[]];
      return [[]];
    });
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CLIENT_MX_PROFILE_MISSING' });
  });

  test('rejects an invoice with no line items (422)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM invoice_items/.test(sql)) return [[]];
      return [[]];
    });
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'NO_LINE_ITEMS' });
  });
});

describe('stampInvoice — conversion', () => {
  test('unpaid invoice → PPD with forma_pago 99 (SAT mandate)', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    const res = await invoiceCfdiService.stampInvoice(60, 1);
    expect(res.stamped).toBe(true);
    const [, docParams] = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    expect(docParams).toContain('PPD');
    expect(docParams).toContain('99');
  });

  test('paid invoice → PUE with forma_pago from the settling payment', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE, status: 'paid' });
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await invoiceCfdiService.stampInvoice(60, 1);
    const [, docParams] = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    expect(docParams).toContain('PUE');
    expect(docParams).toContain('03'); // payment's sat_forma_pago
  });

  test('SAT-code defaults apply per line (81161700/E48) but explicit codes win', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await invoiceCfdiService.stampInvoice(60, 1);
    const conceptos = conn.executed.filter(([sql]) => sql.includes('INSERT INTO cfdi_conceptos'));
    expect(conceptos).toHaveLength(2);
    expect(conceptos[0][1]).toContain('81161700'); // default for line 1
    expect(conceptos[0][1]).toContain('E48');
    expect(conceptos[1][1]).toContain('81161500'); // explicit on line 2
  });

  test('per-line IVA reconciles: importes sum EXACTLY to invoice tax_amount', async () => {
    // 500*0.16=80.00, 300*0.16=48.00 → clean; force a drift case instead:
    Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE, subtotal: '100.01', tax_amount: '16.00', total: '116.01' });
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM invoice_items/.test(sql)) {
        return [[
          { id: 1, description: 'A', quantity: '1', unit_price: '33.34', amount: '33.34', clave_prod_serv: null, clave_unidad: null },
          { id: 2, description: 'B', quantity: '1', unit_price: '33.34', amount: '33.34', clave_prod_serv: null, clave_unidad: null },
          { id: 3, description: 'C', quantity: '1', unit_price: '33.33', amount: '33.33', clave_prod_serv: null, clave_unidad: null },
        ]];
      }
      return [[]];
    });
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await invoiceCfdiService.stampInvoice(60, 1);
    const taxInserts = conn.executed.filter(([sql]) => sql.includes('INSERT INTO cfdi_concepto_impuestos'));
    const importes = taxInserts.map(([, p]) => Number(p[p.length - 1]));
    const sum = Math.round(importes.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(16.00); // never drifts from the invoice's stored tax
  });

  test('zero-tax invoice emits conceptos with ObjetoImp 01 and no impuestos rows', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE, tax_rate: '0.0000', tax_amount: '0.00' });
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await invoiceCfdiService.stampInvoice(60, 1);
    expect(conn.executed.filter(([sql]) => sql.includes('cfdi_concepto_impuestos'))).toHaveLength(0);
    const [, cParams] = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_conceptos'));
    expect(cParams).toContain('01'); // ObjetoImp = no objeto de impuesto
  });

  test('IVA-exempt client (0-tax) emits ObjetoImp 02 and a per-concepto Exento traslado', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE, tax_rate: '0.0000', tax_amount: '0.00' });
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR, tax_exempt: 1 }]];
      if (/FROM invoice_items/.test(sql)) return [ITEMS.map(i => ({ ...i }))];
      if (/FROM payment_allocations/.test(sql)) return [[{ sat_forma_pago: '03' }]];
      return [[]];
    });
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await invoiceCfdiService.stampInvoice(60, 1);
    const [, cParams] = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_conceptos'));
    expect(cParams).toContain('02'); // ObjetoImp = object of tax (exempt), NOT '01'
    const taxInserts = conn.executed.filter(([sql]) => sql.includes('cfdi_concepto_impuestos'));
    expect(taxInserts.length).toBeGreaterThanOrEqual(1);
    expect(taxInserts.every(([sql]) => /'Exento'/.test(sql))).toBe(true); // Exento factor, not Tasa
  });

  test('PAC failure returns stamped:false with the doc kept as draft (retryable)', async () => {
    cfdiService.stamp.mockRejectedValue(new Error('PAC circuit breaker is open'));
    const res = await invoiceCfdiService.stampInvoice(60, 1);
    expect(res.stamped).toBe(false);
    expect(res.cfdi_document_id).toBe(900);
    expect(res.sat_status).toBe('draft');
    expect(res.stamp_error).toContain('circuit breaker');
  });

  test('a DB failure mid-conversion rolls back (no orphan conceptos)', async () => {
    const conn = makeConn();
    const passthrough = conn.execute;
    conn.execute = async (sql, params) => {
      if (sql.includes('INSERT INTO cfdi_conceptos')) throw new Error('boom');
      // Delegate everything else, so the post-lock re-read still resolves —
      // otherwise this test fails on a missing fiscal profile and never
      // reaches the concepto insert it is actually about.
      return passthrough(sql, params);
    };
    db.getConnection.mockResolvedValue(conn);
    await expect(invoiceCfdiService.stampInvoice(60, 1)).rejects.toThrow('boom');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(cfdiService.generateXml).not.toHaveBeenCalled();
  });
});

// =============================================================================
// j48 — the CFDI is built from what the invoice says AFTER the lock
// =============================================================================
// The stamper used to read the invoice, its items and the receptor BEFORE
// db.getConnection(), then write from that snapshot inside the transaction. An
// edit committing in that window was invisible, so the CFDI filed at SAT could
// disagree with the invoice row — and once filed, only a cancellation undoes it.
//
// These drive the interleaving directly: the second read (the one on the
// transaction connection) returns DIFFERENT data from the first, and the
// assertions are that the written values follow the second.
describe('stampInvoice — an edit committing before the lock is not stamped stale', () => {
  const EDITED = { ...INVOICE, subtotal: '2000.00', tax_amount: '320.00', total: '2320.00' };
  const EDITED_ITEMS = [
    { id: 1, description: 'Internet 100M', quantity: '1.00', unit_price: '2000.00', amount: '2000.00', clave_prod_serv: null, clave_unidad: null },
  ];

  /** First call returns `before`, every later call returns `after`. */
  const shifting = (before, after) => {
    let first = true;
    return async () => { const v = first ? before : after; first = false; return v; };
  };

  test('amounts come from the post-lock read, not the pre-flight snapshot', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    Invoice.findByIdOrFail.mockImplementation(shifting({ ...INVOICE }, { ...EDITED }));
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM invoice_items/.test(sql)) return [EDITED_ITEMS.map(i => ({ ...i }))];
      if (/FROM payment_allocations/.test(sql)) return [[{ sat_forma_pago: '03' }]];
      return [[]];
    });

    await invoiceCfdiService.stampInvoice(60, 1);

    const insert = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    expect(insert).toBeDefined();
    // subtotal / total_impuestos / total are the last three bound params.
    const [subtotal, totalImpuestos, total] = insert[1].slice(-3);
    expect(Number(subtotal)).toBe(2000);
    expect(Number(totalImpuestos)).toBe(320);
    expect(Number(total)).toBe(2320);
    // The pre-flight values must appear nowhere in the filed document.
    expect(Number(subtotal)).not.toBe(800);
  });

  test('a client_id change before the lock re-points the RECEPTOR', async () => {
    // The worst version: the CFDI would otherwise be filed against the wrong
    // taxpayer entirely.
    const OTHER = { rfc: 'XAXX010101001', razon_social: 'OTRO CLIENTE', regimen_fiscal: '601', codigo_postal_fiscal: '99999', uso_cfdi_default: null };
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    Invoice.findByIdOrFail.mockImplementation(shifting({ ...INVOICE }, { ...INVOICE, client_id: 99 }));
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) {
        return [[params[1] === 99 ? { ...OTHER } : { ...RECEPTOR }]];
      }
      if (/FROM invoice_items/.test(sql)) return [ITEMS.map(i => ({ ...i }))];
      if (/FROM payment_allocations/.test(sql)) return [[{ sat_forma_pago: '03' }]];
      return [[]];
    });

    await invoiceCfdiService.stampInvoice(60, 1);

    const insert = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    expect(insert[1]).toContain('XAXX010101001');
    expect(insert[1]).not.toContain(RECEPTOR.rfc);
  });

  test('conceptos are built from the post-lock line items', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    Invoice.findByIdOrFail.mockImplementation(shifting({ ...INVOICE }, { ...EDITED }));
    let firstItems = true;
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM invoice_items/.test(sql)) {
        const v = firstItems ? ITEMS.map(i => ({ ...i })) : EDITED_ITEMS.map(i => ({ ...i }));
        firstItems = false;
        return [v];
      }
      if (/FROM payment_allocations/.test(sql)) return [[{ sat_forma_pago: '03' }]];
      return [[]];
    });

    await invoiceCfdiService.stampInvoice(60, 1);

    const conceptos = conn.executed.filter(([sql]) => sql.includes('INSERT INTO cfdi_conceptos'));
    // The pre-flight snapshot had TWO items; the committed edit left one.
    expect(conceptos).toHaveLength(1);
    expect(Number(conceptos[0][1][6])).toBe(2000); // importe
  });

  test('a payment landing before the lock flips PPD/99 to PUE with the real forma', async () => {
    // The likeliest interleaving of all — payments land constantly. metodo_pago
    // and forma_pago are fiscal fields: filing PPD/99 for an invoice that is
    // actually settled misstates the payment method to SAT and leaves the
    // system expecting a REP that will never come.
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    Invoice.findByIdOrFail.mockImplementation(
      shifting({ ...INVOICE, status: 'issued' }, { ...INVOICE, status: 'paid' }),
    );
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM invoice_items/.test(sql)) return [ITEMS.map(i => ({ ...i }))];
      if (/FROM payment_allocations/.test(sql)) return [[{ sat_forma_pago: '03' }]];
      return [[]];
    });

    await invoiceCfdiService.stampInvoice(60, 1);

    const insert = conn.executed.find(([sql]) => sql.includes('INSERT INTO cfdi_documents'));
    expect(insert[1]).toContain('PUE');
    expect(insert[1]).toContain('03');
    expect(insert[1]).not.toContain('PPD');
    expect(insert[1]).not.toContain('99');
  });

  test('the re-read runs on the TRANSACTION, never on the pool', async () => {
    // A db.query here would acquire a second pooled connection while this one
    // is held — the nested-acquire hang fixed in #584.
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE });

    await invoiceCfdiService.stampInvoice(60, 1);

    const lockAt = conn.executed.findIndex(([sql]) => /FOR UPDATE/.test(sql));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    for (const table of [/client_mx_profiles/, /invoice_items/]) {
      const at = conn.executed.findIndex(([sql]) => table.test(sql));
      expect(at).toBeGreaterThan(lockAt);
    }
    // Invoice.findByIdOrFail must be handed the transaction executor the
    // second time, or the invoice itself is still read off the pool.
    const lastCall = Invoice.findByIdOrFail.mock.calls.at(-1);
    expect(typeof lastCall[2]?.exec).toBe('function');
  });
});

describe('stampInvoice — review-hardened fiscal fixes', () => {
  test('percent-style tax_rate (8 = 8%) is normalized: catalog tasa 0.080000, no negative importes', async () => {
    // Manually-created invoices can store tax_rate as a whole percent; the
    // per-line IVA math must use the fraction like every other totals path.
    Invoice.findByIdOrFail.mockResolvedValue({
      ...INVOICE, tax_rate: '8', subtotal: '1000.00', tax_amount: '80.00', total: '1080.00',
    });
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM invoice_items/.test(sql)) {
        return [[
          { id: 1, description: 'A', quantity: '1', unit_price: '600.00', amount: '600.00', clave_prod_serv: null, clave_unidad: null },
          { id: 2, description: 'B', quantity: '1', unit_price: '400.00', amount: '400.00', clave_prod_serv: null, clave_unidad: null },
        ]];
      }
      return [[]];
    });
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    await invoiceCfdiService.stampInvoice(60, 1);
    const taxInserts = conn.executed.filter(([sql]) => sql.includes('cfdi_concepto_impuestos'));
    const importes = taxInserts.map(([, p]) => Number(p[p.length - 1]));
    expect(importes).toEqual([48, 32]); // 600*0.08, 400*0.08 — never 4800/-4720
    expect(importes.every(i => i >= 0)).toBe(true);
    expect(taxInserts[0][1]).toContain('0.080000'); // fraction, a valid SAT catalog rate
  });

  test('non-MXN invoice is refused (422 CFDI_UNSUPPORTED_CURRENCY) — TipoCambio has no source', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ ...INVOICE, currency: 'USD' });
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ statusCode: 422, code: 'CFDI_UNSUPPORTED_CURRENCY' });
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('concurrent stamp race: the in-transaction row-locked guard 409s the loser', async () => {
    // The fast-path check sees nothing (both requests pass it); the loser's
    // in-transaction re-check finds the winner's committed CFDI.
    const conn = makeConn();
    conn.execute = async (sql) => {
      if (/SELECT id FROM invoices WHERE id = \? AND organization_id = \? FOR UPDATE/.test(sql)) return [[{ id: 60 }]];
      if (/FROM cfdi_documents/.test(sql)) return [[{ id: 950 }]]; // winner's CFDI, visible under the lock
      return [{ affectedRows: 1 }];
    };
    db.getConnection.mockResolvedValue(conn);
    await expect(invoiceCfdiService.stampInvoice(60, 1))
      .rejects.toMatchObject({ statusCode: 409, code: 'CFDI_EXISTS' });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.executed.filter(([sql]) => sql.includes('INSERT'))).toHaveLength(0);
  });
});
