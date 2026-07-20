// =============================================================================
// FireISP 5.0 — Invoice void: balance-ledger reversal + paid-invoice handling
// NOTE: Paid invoices CAN now be voided (Capability 1). Voiding a paid invoice
// soft-deletes its payment_allocations (releasing them as client credits) then
// zeroes the invoice's ledger entries. Payment 'credit' rows are NOT removed.
// =============================================================================

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

jest.mock('../src/models/Invoice', () => ({
  findByIdOrFail: jest.fn(),
  update: jest.fn(),
}));

const db = require('../src/config/database');
const Invoice = require('../src/models/Invoice');
const app = require('../src/app');

const ledgerInsert = () => db.query.mock.calls.find(c => /INSERT INTO client_balance_ledger/.test(c[0]));
const ledgerDeleteCredit = () => db.query.mock.calls.find(c => /DELETE FROM client_balance_ledger/.test(c[0]));
const ledgerZero = () => db.query.mock.calls.find(c => /UPDATE client_balance_ledger\s+SET amount = 0/.test(c[0]));

beforeEach(() => { jest.clearAllMocks(); });

describe('PATCH /invoices/:id — void', () => {
  it('voids a PAID invoice: releases allocations + zeroes ledger, leaves payment credits', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'paid', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'void', client_id: 9 });
    db.query
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard: no live CFDI
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // releaseInvoiceAllocations (UPDATE payment_allocations)
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // DELETE any prior void-reversal credit
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE — zero the debit
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('void');
    // First db.query must soft-delete payment_allocations for this invoice
    const allocRelease = db.query.mock.calls.find(c => /UPDATE payment_allocations SET deleted_at/.test(c[0]));
    expect(allocRelease).toBeTruthy();
    expect(allocRelease[1]).toContain(5); // invoice id
    // No new ledger credit is inserted — payment credits stay on the client
    expect(ledgerInsert()).toBeFalsy();
    // The debit row is zeroed
    const zero = ledgerZero();
    expect(zero).toBeTruthy();
    expect(zero[1]).toEqual([5, 9]);
  });

  it('voids an issued invoice by zeroing its ledger entries (no offsetting credit)', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'issued', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'void', client_id: 9 });
    db.query
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard: no live CFDI
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // DELETE any prior void-reversal credit
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE — zero the debit
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('void');
    expect(ledgerInsert()).toBeFalsy(); // never adds a credit line
    expect(ledgerDeleteCredit()).toBeTruthy();
    const zero = ledgerZero();
    expect(zero).toBeTruthy();
    expect(zero[1]).toEqual([5, 9]); // reference_id, client_id
  });

  it('still succeeds (no credit written) when the invoice never had a debit', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'issued', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'void' });
    db.query
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard: no live CFDI
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(ledgerInsert()).toBeFalsy();
  });

  it('does nothing to the ledger when the invoice is already void', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'void', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'void' });
    db.query.mockResolvedValueOnce([[]]); // stamped-CFDI guard: no live CFDI
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(200);
    // Only the guard SELECT ran — the ledger was never touched
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/FROM cfdi_documents/);
    expect(ledgerDeleteCredit()).toBeFalsy();
    expect(ledgerZero()).toBeFalsy();
  });

  // Mexican compliance: a stamped CFDI is registered at SAT at timbrado — an
  // internal void would leave it fiscally valid. The route must refuse and
  // point the caller at the SAT cancellation flow.
  it('422s (INVOICE_STAMPED) when the invoice has a live CFDI — nothing is modified', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'issued', client_id: 9, invoice_number: 'INV-5', currency: 'MXN' });
    db.query.mockResolvedValueOnce([[{ id: 77 }]]); // guard finds a vigente/cancel_pending CFDI
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_STAMPED');
    expect(Invoice.update).not.toHaveBeenCalled();
    expect(ledgerDeleteCredit()).toBeFalsy();
    expect(ledgerZero()).toBeFalsy();
  });

  // 'cancelled' (CFDI cancelled at SAT) is terminal like 'void': its money was
  // released, and the CFDI is permanently cancelado at SAT. Un-cancelling to
  // 'issued' would resurrect a $-total invoice with no allocations (double
  // billing off the freed payment credit).
  it('422s (INVOICE_CANCELLED) on a generic edit of a SAT-cancelled invoice', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'cancelled', client_id: 9, invoice_number: 'INV-5', currency: 'MXN' });
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'issued' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_CANCELLED');
    expect(Invoice.update).not.toHaveBeenCalled();
  });

  it('422s (INVOICE_CANCELLED) when trying to VOID a SAT-cancelled invoice', async () => {
    // The void dispatch bypasses beforeUpdate, so the service must refuse:
    // re-labelling 'cancelled' as 'void' would erase the SAT-cancellation record.
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'cancelled', client_id: 9, invoice_number: 'INV-5', currency: 'MXN' });
    db.query.mockResolvedValueOnce([[]]); // stamped-CFDI guard: cancelado is not live
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_CANCELLED');
    expect(Invoice.update).not.toHaveBeenCalled();
    expect(ledgerZero()).toBeFalsy();
  });

  it("422s (INVOICE_CANCELLED) on a manual status:'cancelled' set — only the SAT flow may set it", async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'issued', client_id: 9, invoice_number: 'INV-5', currency: 'MXN' });
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'cancelled' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_CANCELLED');
    expect(Invoice.update).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled(); // rejected before any guard/fetch
  });

  it('a non-void PATCH still goes through the generic update path', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'overdue', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'overdue' });
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'overdue' });
    expect(res.status).toBe(200);
    expect(ledgerInsert()).toBeFalsy();
    expect(ledgerZero()).toBeFalsy();
  });

  it('rejects un-voiding a void invoice (PATCH to issued) with 422 and writes nothing', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'void', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'issued' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_VOID');
    expect(Invoice.update).not.toHaveBeenCalled();
  });
});

describe('PUT /invoices/:id — void (InvoiceDetail path)', () => {
  it('voids a PAID invoice via PUT: releases allocations + zeroes ledger', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 7, status: 'paid', client_id: 3, invoice_number: 'INV-7', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 7, status: 'void', client_id: 3 });
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // releaseInvoiceAllocations
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // DELETE void-reversal credit
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // zero the debit
    const res = await request(app).put('/api/v1/invoices/7').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(ledgerInsert()).toBeFalsy();
    const zero = ledgerZero();
    expect(zero).toBeTruthy();
    expect(zero[1]).toEqual([7, 3]);
  });

  it('zeroes the ledger on a PUT void', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 7, status: 'issued', client_id: 3, invoice_number: 'INV-7', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 7, status: 'void' });
    db.query
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).put('/api/v1/invoices/7').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(ledgerInsert()).toBeFalsy();
    const zero = ledgerZero();
    expect(zero).toBeTruthy();
    expect(zero[1]).toEqual([7, 3]);
  });

  it('rejects un-voiding a void invoice via PUT with 422', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 7, status: 'void', client_id: 3, invoice_number: 'INV-7', currency: 'USD' });
    const res = await request(app).put('/api/v1/invoices/7').send({ status: 'issued' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_VOID');
    expect(Invoice.update).not.toHaveBeenCalled();
  });
});
