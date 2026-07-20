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

function wireDb({ cfdi = CFDI, prior = { n: 0, pagado: 0 } } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM cfdi_documents\s+WHERE invoice_id/.test(sql)) return [cfdi ? [{ ...cfdi }] : []];
    if (/FROM payments/.test(sql)) return [[{ ...PAYMENT }]];
    if (/FROM invoices/.test(sql)) return [[{ ...INVOICE }]];
    if (/FROM client_mx_profiles/.test(sql)) return [[{ ...RECEPTOR }]];
    if (/FROM cfdi_payment_complement_items/.test(sql)) return [[{ ...prior }]];
    return [[]];
  });
  db.getConnection.mockResolvedValue({ release: jest.fn() });
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
