// =============================================================================
// FireISP 5.0 — Payment Reallocation / Reassign / Void-Paid-Invoice Tests
// =============================================================================
// Three new capabilities:
//   1. Voiding a PAID invoice releases its payment_allocations as client credits
//   2. POST /payments/:id/reallocate  — move allocation A→B (same client only)
//   3. POST /payments/:id/reassign    — move payment to different client (unallocated only)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/Invoice');
jest.mock('../src/models/User');
jest.mock('../src/services/auditLog', () => ({ log: jest.fn() }));

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const config   = require('../src/config');
const db       = require('../src/config/database');
const Invoice  = require('../src/models/Invoice');
const User     = require('../src/models/User');
const app      = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const AUTH = 'Bearer ' + makeToken();

function makeConn(mocks = {}) {
  return {
    beginTransaction: jest.fn(),
    execute: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    ...mocks,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue({
    id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1,
  });
  // Invoice static getters are erased by automock — restore them
  Invoice.hasOrgScope = true;
  Invoice.tableName   = 'invoices';
  Invoice.softDelete  = true;
});

// ===========================================================================
// Capability 1: Void a PAID invoice
// ===========================================================================

describe('Void a PAID invoice (Capability 1)', () => {
  test('voiding a paid invoice is refused until its payments are deallocated', async () => {
    // existing paid invoice
    Invoice.findByIdOrFail.mockResolvedValue({
      id: 10, client_id: 5, status: 'paid', total: '100.00', organization_id: 1,
    });
    Invoice.update.mockResolvedValue({
      id: 10, client_id: 5, status: 'void', total: '100.00', organization_id: 1,
    });

    // Voiding never strips payments as a side effect: the operator must
    // deallocate first (POST /payments/:id/unapply -> unallocated credit).
    db.query
      .mockResolvedValueOnce([[]])              // guard: no live CFDI
      .mockResolvedValueOnce([[{ id: 501 }]]);  // guard: live allocations found

    const res = await request(app)
      .patch('/api/v1/invoices/10')
      .set('Authorization', AUTH)
      .send({ status: 'void' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_HAS_PAYMENTS');
    // Nothing moved: no allocation soft-delete, no ledger writes
    const sqls = db.query.mock.calls.map(c => c[0]).join('\n');
    expect(sqls).not.toMatch(/UPDATE payment_allocations SET deleted_at/);
    expect(sqls).not.toMatch(/client_balance_ledger/);
  });

  test('voiding a non-paid (issued) invoice does NOT call releaseInvoiceAllocations', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({
      id: 11, client_id: 5, status: 'issued', total: '50.00', organization_id: 1,
    });
    Invoice.update.mockResolvedValue({
      id: 11, client_id: 5, status: 'void', total: '50.00', organization_id: 1,
    });

    db.query
      .mockResolvedValueOnce([[]])                    // guard: no live CFDI
      .mockResolvedValueOnce([[]])                    // guard: no live allocations
      .mockResolvedValueOnce([{ affectedRows: 0 }])   // DELETE reversal credit (no allocation release)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // zero ledger entries

    const res = await request(app)
      .patch('/api/v1/invoices/11')
      .set('Authorization', AUTH)
      .send({ status: 'void' });

    expect(res.status).toBe(200);

    // Should NOT have an UPDATE payment_allocations call
    const allCalls = db.query.mock.calls.map(c => c[0]);
    const hasAllocationRelease = allCalls.some(q => q.includes('UPDATE payment_allocations'));
    expect(hasAllocationRelease).toBe(false);
  });

  test('re-voiding an already-void invoice is idempotent — no side effects', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({
      id: 12, client_id: 5, status: 'void', total: '75.00', organization_id: 1,
    });
    Invoice.update.mockResolvedValue({
      id: 12, client_id: 5, status: 'void', total: '75.00', organization_id: 1,
    });
    db.query
      .mockResolvedValueOnce([[]])  // stamped-CFDI guard: no live CFDI
      .mockResolvedValueOnce([[]]); // allocation guard: no payments applied

    const res = await request(app)
      .patch('/api/v1/invoices/12')
      .set('Authorization', AUTH)
      .send({ status: 'void' });

    expect(res.status).toBe(200);
    // Only the two guards ran — no money-moving queries because the
    // status was already 'void'
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0][0]).toMatch(/FROM cfdi_documents/);
    expect(db.query.mock.calls[1][0]).toMatch(/FROM payment_allocations/);
  });
});

// ===========================================================================
// Capability 2: Reallocate payment (POST /payments/:id/reallocate)
// ===========================================================================

describe('POST /payments/:id/reallocate (Capability 2)', () => {
  test('moves allocation from invoice A to invoice B (same client)', async () => {
    const conn = makeConn();
    conn.execute
      // load payment
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '100.00', currency: 'MXN', reference_number: 'REF-1' }]])
      // load existing allocation from→invoice A
      .mockResolvedValueOnce([[{ id: 99, payment_id: 20, invoice_id: 30, amount: '100.00' }]])
      // load both invoices (both client_id = 5)
      .mockResolvedValueOnce([[
        { id: 30, client_id: 5 },
        { id: 31, client_id: 5 },
      ]])
      // soft-delete old allocation
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      // insert new allocation
      .mockResolvedValueOnce([{ insertId: 200 }]);

    db.getConnection.mockResolvedValue(conn);

    // db.query calls for refreshInvoicePaidStatus (×2) + SELECT new alloc
    db.query
      .mockResolvedValueOnce([[{ total: '100.00', allocated: '0.00' }]])  // refresh from-invoice
      .mockResolvedValueOnce([{ affectedRows: 0 }])                       // UPDATE issued
      .mockResolvedValueOnce([[{ total: '100.00', allocated: '100.00' }]]) // refresh to-invoice
      .mockResolvedValueOnce([{ affectedRows: 1 }])                       // UPDATE paid
      .mockResolvedValueOnce([[{ id: 200, payment_id: 20, invoice_id: 31, amount: '100.00' }]]); // final select

    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(201);
    expect(res.body.data.invoice_id).toBe(31);
    expect(conn.commit).toHaveBeenCalled();
  });

  test('returns 422 when payment has no allocation to from_invoice_id', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '100.00', currency: 'MXN' }]])
      .mockResolvedValueOnce([[]]); // no matching allocation

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ALLOCATION_NOT_FOUND');
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('returns 422 when to_invoice_id belongs to a different client', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '100.00', currency: 'MXN' }]])
      .mockResolvedValueOnce([[{ id: 99, payment_id: 20, invoice_id: 30, amount: '100.00' }]])
      // to_invoice belongs to client_id = 99 (different!)
      .mockResolvedValueOnce([[
        { id: 30, client_id: 5 },
        { id: 31, client_id: 99 },
      ]]);

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CROSS_CLIENT_REALLOCATION');
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('returns 404 when payment not found', async () => {
    const conn = makeConn();
    conn.execute.mockResolvedValueOnce([[]]); // no payment
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/999/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(404);
  });

  test('surfaces DB trigger over-allocation error as 422', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '100.00', currency: 'MXN' }]])
      .mockResolvedValueOnce([[{ id: 99, payment_id: 20, invoice_id: 30, amount: '100.00' }]])
      .mockResolvedValueOnce([[
        { id: 30, client_id: 5 },
        { id: 31, client_id: 5 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // soft-delete old alloc
      .mockRejectedValueOnce(Object.assign(new Error('exceeds total'), { sqlState: '45000', errno: 1644 })); // guard trigger fires

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OVER_ALLOCATION');
  });

  test('surfaces a duplicate-allocation (UNIQUE) collision as 422 ALLOCATION_EXISTS', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '100.00', currency: 'MXN' }]])
      .mockResolvedValueOnce([[{ id: 99, payment_id: 20, invoice_id: 30, amount: '100.00' }]])
      .mockResolvedValueOnce([[{ id: 30, client_id: 5 }, { id: 31, client_id: 5 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 }));
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ALLOCATION_EXISTS');
  });

  test('rejects from_invoice_id === to_invoice_id with 422', async () => {
    db.getConnection.mockResolvedValue(makeConn());
    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 30 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 422 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30 }); // missing to_invoice_id

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// Capability 3: Reassign payment (POST /payments/:id/reassign)
// ===========================================================================

describe('POST /payments/:id/reassign (Capability 3)', () => {
  test('moves client_id and ledger credit for an unallocated payment', async () => {
    const conn = makeConn();
    conn.execute
      // load payment
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '200.00', currency: 'MXN', reference_number: 'REF-2' }]])
      // validate new client
      .mockResolvedValueOnce([[{ id: 7 }]])
      // check live allocations — none
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      // DELETE old ledger credit
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      // UPDATE payments.client_id
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      // INSERT new ledger credit
      .mockResolvedValueOnce([{ insertId: 500 }]);

    db.getConnection.mockResolvedValue(conn);

    // db.query for the final SELECT
    db.query.mockResolvedValueOnce([[
      { id: 20, client_id: 7, organization_id: 1, amount: '200.00', currency: 'MXN' },
    ]]);

    const res = await request(app)
      .post('/api/v1/payments/20/reassign')
      .set('Authorization', AUTH)
      .send({ new_client_id: 7 });

    expect(res.status).toBe(200);
    expect(res.body.data.client_id).toBe(7);
    expect(conn.commit).toHaveBeenCalled();

    // Confirm old ledger credit was deleted
    const deleteCall = conn.execute.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('DELETE FROM client_balance_ledger'),
    );
    expect(deleteCall).toBeDefined();

    // Confirm new ledger credit was inserted for new client
    const insertCall = conn.execute.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes("INSERT INTO client_balance_ledger"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe(7); // new_client_id is first param
  });

  test('returns 422 when payment has live allocations', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '200.00', currency: 'MXN' }]])
      .mockResolvedValueOnce([[{ id: 7 }]])       // new client exists
      .mockResolvedValueOnce([[{ cnt: 2 }]]);     // 2 live allocations

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/reassign')
      .set('Authorization', AUTH)
      .send({ new_client_id: 7 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYMENT_ALLOCATED');
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('returns 404 when new_client_id does not exist in org', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '200.00', currency: 'MXN' }]])
      .mockResolvedValueOnce([[]]); // new client not found

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/reassign')
      .set('Authorization', AUTH)
      .send({ new_client_id: 9999 });

    expect(res.status).toBe(404);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('returns 404 when payment not found', async () => {
    const conn = makeConn();
    conn.execute.mockResolvedValueOnce([[]]); // no payment
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/999/reassign')
      .set('Authorization', AUTH)
      .send({ new_client_id: 7 });

    expect(res.status).toBe(404);
  });

  test('returns 422 when new_client_id is missing', async () => {
    const res = await request(app)
      .post('/api/v1/payments/20/reassign')
      .set('Authorization', AUTH)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/payments/20/reassign')
      .send({ new_client_id: 7 });

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// Capability 4 (Bug 1): Void-invoice guards on allocate and reallocate
// ===========================================================================

describe('INVOICE_NOT_PAYABLE guard — POST /payments/:id/allocate', () => {
  // In paymentReallocation.test.js, Payment model is NOT mocked, so
  // Payment.allocate calls db.query for INSERT + SELECT. The route now
  // org-verifies the payment FIRST (see the payments.js org-scoping fix),
  // then does the void guard, so db.query[0] is always the payment lookup.
  const PAYMENT_ROW = { id: 1, client_id: 5, amount: '9999.00', organization_id: 1 };

  test('returns 422 INVOICE_VOID when invoice.status is void', async () => {
    // db.query[0] = SELECT payment (org-verify), [1] = SELECT invoice → void
    db.query
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{
        id: 5, total: '200.00', status: 'void', contract_id: null, organization_id: 1,
      }]]);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .send({ invoice_id: 5, amount: 200 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    expect(res.body.error.message).toMatch(/void invoice/i);
  });

  test('returns 422 INVOICE_NOT_PAYABLE when invoice.status is cancelled', async () => {
    db.query
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{
        id: 5, total: '200.00', status: 'cancelled', contract_id: null, organization_id: 1,
      }]]);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .send({ invoice_id: 5, amount: 200 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    expect(res.body.error.message).toMatch(/cancelled invoice/i);
  });

  test('returns 404 when invoice does not exist', async () => {
    db.query
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[]]); // no invoice row

    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .send({ invoice_id: 9999, amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('returns 404 when the payment does not belong to this org', async () => {
    db.query.mockResolvedValueOnce([[]]); // no payment row for this org

    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .send({ invoice_id: 5, amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // Must not have gone on to look up the invoice at all.
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('returns 422 OVER_ALLOCATION when db trigger fires on INSERT', async () => {
    const invoice = { id: 5, total: '100.00', status: 'issued', contract_id: null, organization_id: 1 };
    // db.query[0] = SELECT payment, [1] = SELECT invoice (non-void), [2] = INSERT in Payment.allocate → trigger fires
    db.query
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[invoice]])
      .mockRejectedValueOnce(Object.assign(new Error('exceeds total'), { sqlState: '45000', errno: 1644 }));

    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .send({ invoice_id: 5, amount: 9999 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OVER_ALLOCATION');
    expect(res.body.error.message).toMatch(/allocation would exceed/i);
  });

  test('normal (non-void) allocate still returns 201', async () => {
    const allocation = { id: 10, payment_id: 1, invoice_id: 5, amount: '100.00' };
    const invoice = { id: 5, total: '100.00', status: 'issued', contract_id: null, organization_id: 1 };

    // SELECT payment (org-verify), SELECT invoice (void guard), INSERT alloc, SELECT alloc, SUM alloc
    db.query
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[invoice]])
      .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }])
      .mockResolvedValueOnce([[allocation]])
      .mockResolvedValueOnce([[{ total_allocated: '100.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE invoices to 'paid'

    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .send({ invoice_id: 5, amount: 100 });

    expect(res.status).toBe(201);
    expect(res.body.data.payment_id).toBe(1);
  });
});

describe('INVOICE_NOT_PAYABLE guard — POST /payments/:id/reallocate', () => {
  test('returns 422 INVOICE_NOT_PAYABLE when to_invoice is void', async () => {
    const conn = makeConn();
    conn.execute
      // load payment
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '100.00', currency: 'MXN' }]])
      // load existing allocation from→invoice A
      .mockResolvedValueOnce([[{ id: 99, payment_id: 20, invoice_id: 30, amount: '100.00' }]])
      // load both invoices: toInv is void
      .mockResolvedValueOnce([[
        { id: 30, client_id: 5, status: 'issued' },
        { id: 31, client_id: 5, status: 'void' },
      ]]);

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    expect(res.body.error.message).toMatch(/void invoice/i);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('allows reallocating AWAY from a void from_invoice', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '100.00', currency: 'MXN', reference_number: 'R' }]])
      .mockResolvedValueOnce([[{ id: 99, payment_id: 20, invoice_id: 30, amount: '100.00' }]])
      // from_invoice is void — that is fine; only to_invoice void is blocked
      .mockResolvedValueOnce([[
        { id: 30, client_id: 5, status: 'void' },
        { id: 31, client_id: 5, status: 'issued' },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])      // soft-delete old alloc
      .mockResolvedValueOnce([{ insertId: 201 }]);        // insert new alloc

    db.getConnection.mockResolvedValue(conn);

    // refreshInvoicePaidStatus (×2) + SELECT new alloc
    db.query
      .mockResolvedValueOnce([[{ total: '100.00', allocated: '0.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[{ total: '100.00', allocated: '100.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 201, payment_id: 20, invoice_id: 31, amount: '100.00' }]]);

    const res = await request(app)
      .post('/api/v1/payments/20/reallocate')
      .set('Authorization', AUTH)
      .send({ from_invoice_id: 30, to_invoice_id: 31 });

    expect(res.status).toBe(201);
    expect(res.body.data.invoice_id).toBe(31);
    expect(conn.commit).toHaveBeenCalled();
  });
});

// ===========================================================================
// Capability 5 (Bug 2): POST /payments/:id/unapply
// ===========================================================================

describe('POST /payments/:id/unapply (Capability 5)', () => {
  test('soft-deletes the allocation and calls refreshInvoicePaidStatus', async () => {
    const conn = makeConn();
    conn.execute
      // load payment (org-scoped)
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '200.00', currency: 'MXN' }]])
      // find live allocation
      .mockResolvedValueOnce([[{ id: 55, payment_id: 20, invoice_id: 10, amount: '200.00' }]])
      // soft-delete allocation
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    db.getConnection.mockResolvedValue(conn);

    // refreshInvoicePaidStatus: SELECT (now under-allocated) + UPDATE to 'issued'
    db.query
      .mockResolvedValueOnce([[{ total: '200.00', allocated: '0.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .post('/api/v1/payments/20/unapply')
      .set('Authorization', AUTH)
      .send({ invoice_id: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.payment_id).toBe(20);
    expect(res.body.data.invoice_id).toBe(10);
    expect(res.body.data.unapplied).toBe(true);

    expect(conn.commit).toHaveBeenCalled();

    // Confirm the soft-delete was issued with the allocation id
    const softDeleteCall = conn.execute.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE payment_allocations SET deleted_at'),
    );
    expect(softDeleteCall).toBeDefined();
    expect(softDeleteCall[1]).toContain(55); // allocation id

    // Confirm refreshInvoicePaidStatus was called (consumes 2 db.query calls)
    expect(db.query).toHaveBeenCalled();
  });

  test('returns 422 ALLOCATION_NOT_FOUND when no live allocation exists', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[{ id: 20, client_id: 5, organization_id: 1, amount: '200.00', currency: 'MXN' }]])
      .mockResolvedValueOnce([[]]); // no live allocation

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/unapply')
      .set('Authorization', AUTH)
      .send({ invoice_id: 10 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ALLOCATION_NOT_FOUND');
    expect(res.body.error.message).toMatch(/not applied to that invoice/i);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('returns 404 when payment not found', async () => {
    const conn = makeConn();
    conn.execute.mockResolvedValueOnce([[]]); // no payment
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/999/unapply')
      .set('Authorization', AUTH)
      .send({ invoice_id: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('returns 422 VALIDATION_ERROR when invoice_id is missing', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/20/unapply')
      .set('Authorization', AUTH)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/payments/20/unapply')
      .send({ invoice_id: 10 });

    expect(res.status).toBe(401);
  });
});
