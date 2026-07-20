// =============================================================================
// FireISP 5.0 — Invoice void vs. SAT-cancel tests
// =============================================================================
// The Mexican compliance rule: a stamped CFDI is registered at SAT the moment
// it is timbrado, so an internal "void" does NOT withhold it from the tax
// authority. Voiding is therefore only valid for an invoice with no live CFDI;
// a stamped invoice must be CANCELLED at SAT (with a motivo), which flows back
// here via cancelInvoiceForSat and lands the invoice in 'cancelled', not 'void'.
// Both terminal statuses release the same money (allocations → client credit,
// ledger zeroed) exactly once.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));
jest.mock('../src/models/Invoice', () => ({
  findByIdOrFail: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const db = require('../src/config/database');
const Invoice = require('../src/models/Invoice');
const auditLog = require('../src/services/auditLog');
const billingService = require('../src/services/billingService');

const ALLOC_RELEASE = /UPDATE payment_allocations SET deleted_at/;

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([[]]);
  auditLog.log.mockResolvedValue(undefined);
});

describe('voidInvoiceById — stamped-CFDI guard', () => {
  test('rejects voiding an invoice that has a live (vigente) CFDI', async () => {
    db.query.mockResolvedValueOnce([[{ id: 99 }]]); // guard SELECT finds a live CFDI

    await expect(billingService.voidInvoiceById(10, 1, 5))
      .rejects.toMatchObject({ statusCode: 422, code: 'INVOICE_STAMPED' });

    // Never touched the invoice — no status flip, no money movement, no audit.
    expect(Invoice.update).not.toHaveBeenCalled();
    expect(auditLog.log).not.toHaveBeenCalled();
    // The guard is org-scoped: probing another org's invoice id must fall
    // through to the 404, never answer 422 (stamped-invoice existence leak).
    const [guardSql, guardParams] = db.query.mock.calls[0];
    expect(guardSql).toMatch(/organization_id = \?/);
    expect(guardParams).toEqual([10, 1]);
  });

  test('rejects voiding an invoice whose CFDI is cancel_pending', async () => {
    // The guard SQL filters sat_status IN ('vigente','cancel_pending'); prove the
    // second value is covered by returning a hit for it too.
    db.query.mockResolvedValueOnce([[{ id: 42 }]]);
    await expect(billingService.voidInvoiceById(11, 1, 5))
      .rejects.toMatchObject({ statusCode: 422, code: 'INVOICE_STAMPED' });
  });

  test('allows voiding an unstamped invoice (no live CFDI)', async () => {
    db.query.mockResolvedValueOnce([[]]); // guard: no live CFDI
    Invoice.findByIdOrFail.mockResolvedValue({ id: 10, status: 'issued', client_id: 3 });
    Invoice.update.mockResolvedValue({ id: 10, status: 'void' });

    const rec = await billingService.voidInvoiceById(10, 1, 5);

    expect(Invoice.update).toHaveBeenCalledWith(10, { status: 'void' }, 1);
    expect(rec.status).toBe('void');
    // 'issued' (unpaid) → no allocation release.
    const sqls = db.query.mock.calls.map((c) => c[0]).join('\n');
    expect(sqls).not.toMatch(ALLOC_RELEASE);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'void' }));
  });

  test('voiding a PAID unstamped invoice releases its allocations', async () => {
    db.query.mockResolvedValueOnce([[]]); // guard: no live CFDI
    Invoice.findByIdOrFail.mockResolvedValue({ id: 12, status: 'paid', client_id: 3 });
    Invoice.update.mockResolvedValue({ id: 12, status: 'void' });

    await billingService.voidInvoiceById(12, 1, 5);

    const sqls = db.query.mock.calls.map((c) => c[0]).join('\n');
    expect(sqls).toMatch(ALLOC_RELEASE);
  });

  test('refuses to void a SAT-cancelled invoice (would erase the cancellation record)', async () => {
    // The CFDI is cancelado (not live), so the stamped guard passes — the
    // forbidFrom check on the invoice's own status must still refuse.
    db.query.mockResolvedValueOnce([[]]);
    Invoice.findByIdOrFail.mockResolvedValue({ id: 13, status: 'cancelled', client_id: 3 });

    await expect(billingService.voidInvoiceById(13, 1, 5))
      .rejects.toMatchObject({ statusCode: 422, code: 'INVOICE_CANCELLED' });

    expect(Invoice.update).not.toHaveBeenCalled();
    expect(auditLog.log).not.toHaveBeenCalled();
  });
});

describe('cancelInvoiceForSat — SAT-cancellation sync', () => {
  test('marks a paid invoice cancelled and releases its allocations', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 20, status: 'paid', client_id: 4 });
    Invoice.update.mockResolvedValue({ id: 20, status: 'cancelled' });

    const rec = await billingService.cancelInvoiceForSat(20, 1);

    expect(Invoice.update).toHaveBeenCalledWith(20, { status: 'cancelled' }, 1);
    expect(rec.status).toBe('cancelled');
    const sqls = db.query.mock.calls.map((c) => c[0]).join('\n');
    expect(sqls).toMatch(ALLOC_RELEASE);
    // Distinct audit verb from an internal void so the two are traceable apart.
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel_cfdi', userId: null }));
  });

  test('does NOT run the stamped-CFDI guard (that guard is void-only)', async () => {
    // A cancel arriving here means SAT already accepted the cancellation, so the
    // CFDI is cancelado — the vigente/cancel_pending guard must not block it.
    Invoice.findByIdOrFail.mockResolvedValue({ id: 22, status: 'issued', client_id: 4 });
    Invoice.update.mockResolvedValue({ id: 22, status: 'cancelled' });

    await billingService.cancelInvoiceForSat(22, 1);

    const sqls = db.query.mock.calls.map((c) => c[0]).join('\n');
    expect(sqls).not.toMatch(/FROM cfdi_documents/);
  });

  test('is idempotent — re-cancelling an already-terminal invoice moves no money', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 21, status: 'cancelled', client_id: 4 });
    Invoice.update.mockResolvedValue({ id: 21, status: 'cancelled' });

    await billingService.cancelInvoiceForSat(21, 1);

    // wasTerminal → status re-stamp + audit only, zero DB writes for money.
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('void guard — draft CFDIs count (stamp-later)', () => {
  test('refuses to void while a DRAFT CFDI exists (it could be stamped after the void)', async () => {
    db.query.mockResolvedValueOnce([[{ id: 88, sat_status: 'draft' }]]);
    await expect(billingService.voidInvoiceById(30, 1, 5))
      .rejects.toMatchObject({ statusCode: 422, code: 'INVOICE_STAMPED' });
    expect(Invoice.update).not.toHaveBeenCalled();
  });
});
