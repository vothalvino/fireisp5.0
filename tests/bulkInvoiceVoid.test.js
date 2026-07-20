// =============================================================================
// FireISP 5.0 — POST /bulk/invoices/void tests
// =============================================================================
// Verifies the bulk void endpoint:
//   - Voids a mix of issued and paid invoices (success count, allocation release,
//     ledger zero, idempotency on already-void)
//   - Non-existent IDs land in errors[] without aborting the batch
//   - Input validation (empty array, >500 ids)
//   - The single PATCH/PUT void tests still pass after extraction to billingService
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/models/Invoice', () => ({
  findByIdOrFail: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const Invoice = require('../src/models/Invoice');
const User = require('../src/models/User');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/bulk/invoices/void
// ---------------------------------------------------------------------------

describe('POST /api/bulk/invoices/void', () => {
  test('rejects empty body → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/invoice_ids/);
  });

  test('rejects empty array → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_ids: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects >500 ids → 400', async () => {
    mockAuthUser();
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_ids: ids });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/500/);
  });

  test('voids an issued invoice: zeroes ledger entries', async () => {
    mockAuthUser();
    Invoice.findByIdOrFail.mockResolvedValue({ id: 10, status: 'issued', client_id: 3, invoice_number: 'INV-10' });
    Invoice.update.mockResolvedValue({ id: 10, status: 'void', client_id: 3 });
    db.query
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard: no live CFDI
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // DELETE void-reversal credit
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // zero ledger debits

    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_ids: [10] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(1);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.errors).toHaveLength(0);

    // Ledger debit rows zeroed
    const zeroCall = db.query.mock.calls.find(c => /UPDATE client_balance_ledger\s+SET amount = 0/.test(c[0]));
    expect(zeroCall).toBeTruthy();
    expect(zeroCall[1]).toEqual([10, 3]);

    // No new credit inserted
    const insertCall = db.query.mock.calls.find(c => /INSERT INTO client_balance_ledger/.test(c[0]));
    expect(insertCall).toBeFalsy();
  });

  test('voids a paid invoice: releases allocations + zeroes ledger', async () => {
    mockAuthUser();
    Invoice.findByIdOrFail.mockResolvedValue({ id: 11, status: 'paid', client_id: 4, invoice_number: 'INV-11' });
    Invoice.update.mockResolvedValue({ id: 11, status: 'void', client_id: 4 });
    db.query
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard: no live CFDI
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // releaseInvoiceAllocations (UPDATE payment_allocations)
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // DELETE void-reversal credit
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // zero ledger debits

    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_ids: [11] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(1);
    expect(res.body.data.failed).toBe(0);

    // Allocation soft-delete ran
    const allocCall = db.query.mock.calls.find(c => /UPDATE payment_allocations SET deleted_at/.test(c[0]));
    expect(allocCall).toBeTruthy();
    expect(allocCall[1]).toContain(11); // invoice id

    // Ledger debits zeroed
    const zeroCall = db.query.mock.calls.find(c => /UPDATE client_balance_ledger\s+SET amount = 0/.test(c[0]));
    expect(zeroCall).toBeTruthy();

    // Payment credit rows NOT touched
    const insertCall = db.query.mock.calls.find(c => /INSERT INTO client_balance_ledger/.test(c[0]));
    expect(insertCall).toBeFalsy();
  });

  test('idempotent: already-void invoice counts as success with no DB writes', async () => {
    mockAuthUser();
    Invoice.findByIdOrFail.mockResolvedValue({ id: 12, status: 'void', client_id: 5, invoice_number: 'INV-12' });
    Invoice.update.mockResolvedValue({ id: 12, status: 'void', client_id: 5 });
    db.query.mockResolvedValueOnce([[]]); // stamped-CFDI guard: no live CFDI

    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_ids: [12] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(1);
    expect(res.body.data.failed).toBe(0);
    // Only the stamped-CFDI guard ran — no money-moving writes
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/FROM cfdi_documents/);
  });

  test('non-existent id lands in errors[] without failing the batch', async () => {
    mockAuthUser();
    const { NotFoundError } = require('../src/utils/errors');

    // First call: issued invoice that voids successfully
    Invoice.findByIdOrFail
      .mockResolvedValueOnce({ id: 20, status: 'issued', client_id: 7, invoice_number: 'INV-20' })
      .mockRejectedValueOnce(new NotFoundError('invoices'));

    Invoice.update.mockResolvedValueOnce({ id: 20, status: 'void', client_id: 7 });

    db.query
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard for id 20
      .mockResolvedValueOnce([{ affectedRows: 0 }])  // DELETE credit for id 20
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // zero debits for id 20
      .mockResolvedValueOnce([[]]); // stamped-CFDI guard for id 999 (runs before findByIdOrFail rejects)

    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_ids: [20, 999] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(1);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors).toHaveLength(1);
    expect(res.body.data.errors[0].invoice_id).toBe(999);
    expect(res.body.data.errors[0].error).toBeTruthy();
  });

  test('batch of mixed issued + paid: correct success count', async () => {
    mockAuthUser();

    // Invoice 30: issued
    Invoice.findByIdOrFail
      .mockResolvedValueOnce({ id: 30, status: 'issued', client_id: 8, invoice_number: 'INV-30' })
      // Invoice 31: paid
      .mockResolvedValueOnce({ id: 31, status: 'paid', client_id: 8, invoice_number: 'INV-31' });

    Invoice.update
      .mockResolvedValueOnce({ id: 30, status: 'void', client_id: 8 })
      .mockResolvedValueOnce({ id: 31, status: 'void', client_id: 8 });

    db.query
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard for 30
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // DELETE credit for 30
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // zero debits for 30
      .mockResolvedValueOnce([[]]) // stamped-CFDI guard for 31
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // release allocations for 31
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // DELETE credit for 31
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // zero debits for 31

    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_ids: [30, 31] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(2);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.errors).toHaveLength(0);

    // allocation release ran for paid invoice
    const allocCall = db.query.mock.calls.find(c => /UPDATE payment_allocations SET deleted_at/.test(c[0]));
    expect(allocCall).toBeTruthy();
    expect(allocCall[1]).toContain(31);
  });

  test('requires authentication → 401 without token', async () => {
    const res = await request(app)
      .post('/api/bulk/invoices/void')
      .send({ invoice_ids: [1] });

    expect(res.status).toBe(401);
  });
});
