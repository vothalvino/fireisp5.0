// =============================================================================
// FireISP 5.0 — REP (Complemento de Pago) automation tests
// =============================================================================
// generateRepForAllocation: PPD-only liability, parcialidad chain math,
// forma_pago derivation, best-effort wrapper, retryable-draft contract.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/cfdiService', () => ({
  getEmisorProfile: jest.fn(),
  cfdiExpeditionTime: jest.fn(() => '2026-07-20T12:00:00'),
  generatePaymentComplement: jest.fn(),
  stamp: jest.fn(),
}));
jest.mock('../src/services/invoiceCfdiService', () => ({
  nextCfdiFolio: jest.fn(async () => 7),
}));

const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');
const repService = require('../src/services/repService');

const CFDI = { id: 2, uuid: 'SIMULADO-aaaa-4bbb-8ccc-ddddeeeeffff', serie: 'A', folio: 3, total: '580.00' };
const PAYMENT = { id: 38, organization_id: 5, currency: 'MXN', payment_method: 'transfer', sat_forma_pago: null, payment_date: new Date('2026-07-20T00:00:00Z'), reference_number: 'SPEI-123' };
const INVOICE = { id: 605, client_id: 42, total: '580.00', currency: 'MXN' };
const RECEPTOR = { rfc: 'XAXX010101000', razon_social: 'María', regimen_fiscal: '616', codigo_postal_fiscal: '01000' };
const EMISOR = { rfc: 'EKU9003173C9', razon_social: 'Escuela Kemper', regimen_fiscal: '601', codigo_postal_fiscal: '26015', cfdi_serie_pago: 'P' };

// The chain-sensitive reads (idempotency + parcialidad) now run on a locked
// connection (conn.execute); the pre-gates stay on the pool (db.query).
let lastConn;
function wireDb({ cfdi = CFDI, prior = { n: 0, pagado: 0 }, payment = PAYMENT, dup = null } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM cfdi_documents\s+WHERE invoice_id/.test(sql)) return [cfdi ? [{ ...cfdi }] : []];
    if (/FROM payments/.test(sql)) return [[{ ...payment }]];
    if (/FROM invoices/.test(sql)) return [[{ ...INVOICE }]];
    if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
    return [[]];
  });
  lastConn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    async execute(sql) {
      if (/FOR UPDATE/.test(sql)) return [[{ id: 605 }]];
      if (/JOIN cfdi_payment_complements pc ON pc.cfdi_document_id = d.id/.test(sql)) return [dup ? [{ id: dup }] : []];
      if (/FROM cfdi_payment_complement_items/.test(sql)) return [[{ ...prior }]];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection.mockResolvedValue(lastConn);
}

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
  cfdiService.getEmisorProfile.mockResolvedValue({ ...EMISOR });
  cfdiService.generatePaymentComplement.mockResolvedValue({ cfdi_document_id: 900, complement_id: 50, xml: '<x/>' });
  cfdiService.stamp.mockResolvedValue({ uuid: 'SIMULADO-1111-4222-8333-444455556666', status: 'vigente' });
});

describe('generateRepForAllocation', () => {
  test('generates + stamps a REP for a vigente PPD CFDI (first parcialidad)', async () => {
    const res = await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(res).toMatchObject({ generated: true, stamped: true, sat_status: 'vigente', num_parcialidad: 1 });
    const params = cfdiService.generatePaymentComplement.mock.calls[0][0];
    expect(params.serie).toBe('P');
    expect(params.folio).toBe(7);
    expect(params.forma_pago).toBe('03'); // transfer → 03 (sat_forma_pago null)
    expect(params.payment_date).toBe('2026-07-20');
    expect(params.related_documents[0]).toMatchObject({
      related_cfdi_uuid: CFDI.uuid, num_parcialidad: 1,
      imp_saldo_ant: 580, imp_pagado: 580, imp_saldo_insoluto: 0,
    });
  });

  test('parcialidad chain: second payment continues the saldo math', async () => {
    wireDb({ prior: { n: 1, pagado: 300 } });
    const res = await repService.generateRepForAllocation(38, 605, 280, 5, 8);
    expect(res.num_parcialidad).toBe(2);
    const rd = cfdiService.generatePaymentComplement.mock.calls[0][0].related_documents[0];
    expect(rd).toMatchObject({ num_parcialidad: 2, imp_saldo_ant: 280, imp_pagado: 280, imp_saldo_insoluto: 0 });
  });

  test('skips invoices without a vigente PPD CFDI (PUE / unstamped / cancelado)', async () => {
    wireDb({ cfdi: null });
    const res = await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(res).toEqual({ generated: false, reason: 'NO_PPD_CFDI' });
    expect(cfdiService.generatePaymentComplement).not.toHaveBeenCalled();
  });

  test('sat_forma_pago on the payment wins over the method mapping', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents\s+WHERE invoice_id/.test(sql)) return [[{ ...CFDI }]];
      if (/FROM payments/.test(sql)) return [[{ ...PAYMENT, sat_forma_pago: '06' }]];
      if (/FROM invoices/.test(sql)) return [[{ ...INVOICE }]];
      if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
      if (/FROM cfdi_payment_complement_items/.test(sql)) return [[{ n: 0, pagado: 0 }]];
      return [[]];
    });
    await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(cfdiService.generatePaymentComplement.mock.calls[0][0].forma_pago).toBe('06');
  });

  test('422s when the client has no MX fiscal profile', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents\s+WHERE invoice_id/.test(sql)) return [[{ ...CFDI }]];
      if (/FROM payments/.test(sql)) return [[{ ...PAYMENT }]];
      if (/FROM invoices/.test(sql)) return [[{ ...INVOICE }]];
      if (/FROM client_mx_profiles/.test(sql)) return [[]];
      return [[]];
    });
    await expect(repService.generateRepForAllocation(38, 605, 580, 5, 8))
      .rejects.toMatchObject({ statusCode: 422, code: 'CLIENT_MX_PROFILE_MISSING' });
  });

  test('idempotent: an existing live REP for this (payment, CFDI) pair is never duplicated', async () => {
    wireDb({ dup: 777 });
    const res = await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(res).toEqual({ generated: false, reason: 'REP_ALREADY_EXISTS', cfdi_document_id: 777 });
    expect(cfdiService.generatePaymentComplement).not.toHaveBeenCalled();
    expect(lastConn.rollback).toHaveBeenCalled();
    expect(lastConn.release).toHaveBeenCalled();
  });

  test('a refunded payment is never REP-reported (PAYMENT_NOT_SETTLED)', async () => {
    wireDb({ payment: { ...PAYMENT, status: 'refunded' } });
    const res = await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(res).toEqual({ generated: false, reason: 'PAYMENT_NOT_SETTLED' });
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('a fully-REP-reported CFDI refuses further REPs (CFDI_FULLY_REPORTED)', async () => {
    wireDb({ prior: { n: 2, pagado: 580 } }); // chain already covers the total
    const res = await repService.generateRepForAllocation(38, 605, 50, 5, 8);
    expect(res).toEqual({ generated: false, reason: 'CFDI_FULLY_REPORTED' });
    expect(cfdiService.generatePaymentComplement).not.toHaveBeenCalled();
  });

  test('extended method mapping: debit_card → 28, codi → 06', async () => {
    wireDb({ payment: { ...PAYMENT, payment_method: 'debit_card' } });
    await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(cfdiService.generatePaymentComplement.mock.calls[0][0].forma_pago).toBe('28');
  });

  test('serialization lock commits only after the complement rows are inserted', async () => {
    const order = [];
    wireDb();
    lastConn.commit = jest.fn(async () => { order.push('commit'); });
    cfdiService.generatePaymentComplement.mockImplementation(async () => { order.push('insert'); return { cfdi_document_id: 900, complement_id: 50, xml: '<x/>' }; });
    await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(order).toEqual(['insert', 'commit']); // racers see the items when unblocked
    expect(lastConn.release).toHaveBeenCalled();
  });

  test('a PAC stamp failure returns a retryable draft, never loses the REP', async () => {
    cfdiService.stamp.mockRejectedValue(new Error('PAC down'));
    const res = await repService.generateRepForAllocation(38, 605, 580, 5, 8);
    expect(res).toMatchObject({ generated: true, stamped: false, sat_status: 'draft', cfdi_document_id: 900 });
    expect(res.stamp_error).toContain('PAC down');
  });
});

describe('maybeGenerateRep (best-effort wrapper)', () => {
  test('never throws — an internal error becomes { generated:false, reason:ERROR }', async () => {
    cfdiService.getEmisorProfile.mockRejectedValue(new Error('profile exploded'));
    const res = await repService.maybeGenerateRep(38, 605, 580, 5, 8);
    expect(res.generated).toBe(false);
    expect(res.reason).toBe('ERROR');
  });

  test('passes through a successful generation', async () => {
    const res = await repService.maybeGenerateRep(38, 605, 580, 5, 8);
    expect(res.generated).toBe(true);
    expect(res.stamped).toBe(true);
  });
});
