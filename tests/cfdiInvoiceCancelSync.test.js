// =============================================================================
// FireISP 5.0 — CFDI cancellation → invoice sync wiring
// =============================================================================
// When SAT ACCEPTS a CFDI cancellation (sat_status → 'cancelado'), cfdiService
// must sync the underlying invoice to 'cancelled' via billingService so it drops
// out of receivables and tax reports. billingService is mocked here so we assert
// only the wiring: the cancel flow reaches the accepted branch and calls
// cancelInvoiceForSat with the invoice behind the CFDI.
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/billingService', () => ({
  cancelInvoiceForSat: jest.fn().mockResolvedValue({ status: 'cancelled' }),
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const cfdiService = require('../src/services/cfdiService');

// A vigente CFDI (id 7) stamped for invoice 55, org 1. 'dev_placeholder' is an
// unknown provider → callPacCancel returns a simulated 'accepted' outside prod.
const DOC = { id: 7, organization_id: 1, invoice_id: 55, uuid: 'UUID-VIGENTE-1', sat_status: 'vigente' };
const PAC = { id: 2, provider_name: 'dev_placeholder', organization_id: 1, status: 'active' };

beforeEach(() => {
  jest.clearAllMocks();
  cfdiService.circuitBreaker.failures = 0;
  cfdiService.circuitBreaker.lastFailure = 0;
  db.query.mockImplementation((sql) => {
    if (/SELECT invoice_id, organization_id FROM cfdi_documents/.test(sql)) {
      return Promise.resolve([[{ invoice_id: 55, organization_id: 1 }]]);
    }
    if (/SELECT \* FROM cfdi_documents WHERE id = \?/.test(sql)) return Promise.resolve([[DOC]]);
    if (/FROM pac_providers/.test(sql)) return Promise.resolve([[PAC]]);
    if (/INSERT INTO cfdi_cancellations/.test(sql)) return Promise.resolve([{ insertId: 900 }]);
    return Promise.resolve([[]]);
  });
});

test('accepting a SAT cancellation syncs the invoice to cancelled', async () => {
  const res = await cfdiService.cancel(7, '02', null);

  expect(res.status).toBe('cancelado');
  expect(billingService.cancelInvoiceForSat).toHaveBeenCalledWith(55, 1, null);
});

test('a CFDI with no linked invoice does not attempt a sync', async () => {
  db.query.mockImplementation((sql) => {
    if (/SELECT invoice_id, organization_id FROM cfdi_documents/.test(sql)) {
      return Promise.resolve([[{ invoice_id: null, organization_id: 1 }]]);
    }
    if (/SELECT \* FROM cfdi_documents WHERE id = \?/.test(sql)) return Promise.resolve([[DOC]]);
    if (/FROM pac_providers/.test(sql)) return Promise.resolve([[PAC]]);
    if (/INSERT INTO cfdi_cancellations/.test(sql)) return Promise.resolve([{ insertId: 901 }]);
    return Promise.resolve([[]]);
  });

  const res = await cfdiService.cancel(7, '02', null);

  expect(res.status).toBe('cancelado');
  expect(billingService.cancelInvoiceForSat).not.toHaveBeenCalled();
});

test('a sync failure does not fail the (already-succeeded) SAT cancellation', async () => {
  billingService.cancelInvoiceForSat.mockRejectedValueOnce(new Error('ledger down'));

  const res = await cfdiService.cancel(7, '02', null);

  // The CFDI is cancelado at SAT regardless — the sync is best-effort.
  expect(res.status).toBe('cancelado');
});

test('refuses to cancel a CFDI while a vigente payment complement (REP) references it', async () => {
  // SAT requires the REP to be cancelled first; the guard must fire BEFORE any
  // state change (no cfdi_cancellations insert, no cancel_pending flip, no PAC).
  db.query.mockImplementation((sql) => {
    if (/FROM cfdi_payment_complement_items/.test(sql)) {
      return Promise.resolve([[{ id: 30, uuid: 'REP-UUID-0001' }]]);
    }
    if (/SELECT \* FROM cfdi_documents WHERE id = \?/.test(sql)) return Promise.resolve([[DOC]]);
    if (/FROM pac_providers/.test(sql)) return Promise.resolve([[PAC]]);
    return Promise.resolve([[]]);
  });

  await expect(cfdiService.cancel(7, '02', null))
    .rejects.toMatchObject({ statusCode: 422, code: 'CFDI_HAS_LIVE_REP' });

  const sqls = db.query.mock.calls.map((c) => c[0]).join('\n');
  expect(sqls).not.toMatch(/INSERT INTO cfdi_cancellations/);
  expect(sqls).not.toMatch(/SET sat_status/);
  expect(billingService.cancelInvoiceForSat).not.toHaveBeenCalled();
});
