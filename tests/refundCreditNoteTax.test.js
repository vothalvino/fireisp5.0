'use strict';
// =============================================================================
// FireISP 5.0 — a refund credit note carries the IVA the invoice carried (j5)
// =============================================================================
// processRequest's credit_note branch inserted `subtotal = amount, tax = 0,
// total = amount` with no organization_id and no currency. Four defects in one
// statement, each of which writes a wrong fiscal row:
//
//   1. tax_amount 0 on a refund of a taxed invoice. refund_requests.amount is
//      what the subscriber gets BACK, so it is tax-inclusive: refunding a 1160
//      invoice (1000 + 16% IVA) is 1160, not 1000. Booking that as subtotal
//      1160 / tax 0 stamps a CFDI de Egreso declaring the credited operation
//      was not taxable, while the ingreso it relates to (TipoRelacion 01)
//      declared IVA on the same money — the two contradict each other at SAT.
//   2. No organization_id, so on a multi-tenant install the credit note landed
//      with NULL org: invisible to the org-scoped list, unstampable, orphaned.
//   3. No currency, so it fell to the column default 'USD' — on a Mexican
//      install it then fails to stamp with CFDI_UNSUPPORTED_CURRENCY. Same
//      bug the CSV importer had (#559).
//   4. The whole insert was wrapped in a catch that logged a warn, so a
//      failure left the request marked 'processed' with no credit note at all.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(),
}));
jest.mock('../src/services/eventBus', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../src/services/billingAdjustmentService', () => ({ record: jest.fn().mockResolvedValue({ id: 1 }) }));
jest.mock('../src/models/Organization', () => ({ getCurrency: jest.fn().mockResolvedValue('MXN') }));
jest.mock('../src/utils/logger', () => {
  const m = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => m) };
  return m;
});

const db = require('../src/config/database');
const Organization = require('../src/models/Organization');
const refundRequestService = require('../src/services/refundRequestService');

const APPROVED = {
  id: 10, organization_id: 1, client_id: 5, payment_id: null, invoice_id: 30,
  amount: '1160.00', reason: 'overcharge', status: 'approved',
  resulting_credit_note_id: null,
};

/**
 * @param invoice the row /invoices returns for the credited invoice, or null
 *                to simulate a refund with no invoice behind it.
 * @param clientTaxRate what resolveTaxContext should land on in that case.
 */
function wireDb({ refund = APPROVED, invoice = { tax_rate: '0.1600', currency: 'MXN' }, clientTaxRate = '0.1600' } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM `?refund_requests`?/.test(sql)) return [[refund]];
    if (/FROM `?clients`?/.test(sql)) return [[{ id: 5, tax_exempt: 0, locale: 'MX', zip_code: '06000', email: 'c@x.mx', name: 'Cliente' }]];
    if (/FROM `?invoices`?/.test(sql)) return [invoice ? [invoice] : []];
    if (/FROM `?tax_rules`?/.test(sql)) return [[]];
    if (/FROM `?tax_rates`?/.test(sql)) return [clientTaxRate === null ? [] : [{ id: 9, rate: clientTaxRate }]];
    if (/INSERT INTO credit_notes/.test(sql)) return [{ insertId: 77 }];
    if (/^UPDATE `?refund_requests`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const cnInsert = () => db.query.mock.calls.find(c => /INSERT INTO credit_notes/.test(c[0]));
const process = () => refundRequestService.processRequest(1, 10, { refund_method: 'credit_note' }, 3);

beforeEach(() => {
  jest.clearAllMocks();
  Organization.getCurrency.mockResolvedValue('MXN');
});

describe('the refund amount is split at the ORIGINAL invoice rate', () => {
  it('books 1160 as 1000 + 160 IVA, not 1160 + 0', async () => {
    wireDb();
    await process();
    const params = cnInsert()[1];
    expect(params).toContain(1000);      // subtotal
    expect(params).toContain(160);       // tax_amount
    expect(params).toContain(0.16);      // tax_rate
    expect(params).toContain('1160.00'); // total — the gross the client gets back
  });

  it('subtotal + tax equals the gross EXACTLY, even when the split is not round', async () => {
    // 100.00 gross at 16% is 86.2068...; the stored pair must still sum to the
    // total, because create and stamp both check subtotal + tax === total.
    wireDb({ refund: { ...APPROVED, amount: '100.00' } });
    await process();
    const p = cnInsert()[1];
    const subtotal = p[4];
    const tax = p[6];
    expect(Number((subtotal + tax).toFixed(2))).toBe(100);
    expect(tax).toBe(13.79);
    expect(subtotal).toBe(86.21);
  });

  it('uses the INVOICE rate, not what the client would be charged today', async () => {
    // A frontera invoice stamped at 8% and refunded after the org moved to 16%
    // must be credited at 8% — that is the rate the money was taxed at.
    wireDb({ invoice: { tax_rate: '0.0800', currency: 'MXN' }, clientTaxRate: '0.1600' });
    await process();
    const p = cnInsert()[1];
    expect(p).toContain(0.08);
    expect(p).toContain(85.93);   // tax on 1160 at 8%
  });

  it('writes zero tax for a genuinely untaxed invoice', async () => {
    wireDb({ invoice: { tax_rate: '0.0000', currency: 'MXN' } });
    await process();
    const p = cnInsert()[1];
    expect(p).toContain(0);
    expect(p).toContain(1160);   // the whole gross is subtotal
  });

  it('falls back to the client tax context when the refund has no invoice', async () => {
    wireDb({ refund: { ...APPROVED, invoice_id: null } });
    await process();
    expect(cnInsert()[1]).toContain(0.16);
  });
});

describe('the credit note is not orphaned', () => {
  it('carries the organization_id', async () => {
    wireDb();
    expect(cnInsert.length).toBeDefined();
    await process();
    expect(cnInsert()[0]).toMatch(/organization_id/);
    expect(cnInsert()[1][0]).toBe(1);
  });

  it("carries the invoice's currency, not the column default USD", async () => {
    wireDb();
    await process();
    expect(cnInsert()[0]).toMatch(/currency/);
    expect(cnInsert()[1]).toContain('MXN');
  });

  it("falls back to the ORG's currency when the refund has no invoice", async () => {
    Organization.getCurrency.mockResolvedValue('MXN');
    wireDb({ refund: { ...APPROVED, invoice_id: null } });
    await process();
    expect(cnInsert()[1]).toContain('MXN');
    expect(cnInsert()[1]).not.toContain('USD');
  });
});

describe('a failed credit note is not reported as a processed refund', () => {
  it('propagates the error and leaves the request un-processed', async () => {
    wireDb();
    db.query.mockImplementation(async (sql) => {
      if (/FROM `?refund_requests`?/.test(sql)) return [[APPROVED]];
      if (/FROM `?clients`?/.test(sql)) return [[{ id: 5, tax_exempt: 0, locale: 'MX', zip_code: '06000' }]];
      if (/FROM `?invoices`?/.test(sql)) return [[{ tax_rate: '0.1600', currency: 'MXN' }]];
      if (/INSERT INTO credit_notes/.test(sql)) throw new Error('ER_NO_REFERENCED_ROW');
      return [[]];
    });
    await expect(process()).rejects.toThrow(/ER_NO_REFERENCED_ROW/);
    // The status write lives after this branch — it must never have run.
    const marked = db.query.mock.calls.some(c => /^UPDATE `?refund_requests`?/i.test(c[0]) && /status/i.test(c[0]));
    expect(marked).toBe(false);
  });
});
