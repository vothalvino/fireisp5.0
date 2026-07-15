// =============================================================================
// FireISP 5.0 — POST /payments/:id/allocate-auto (FIFO waterfall)
// =============================================================================
// Atomic, multi-invoice, oldest→newest payment allocation. Drives the real
// route + src/services/paymentAllocationService.js through a mocked
// PoolConnection, so a bad column/param list or a broken transaction boundary
// shows up here rather than as a 500/wrong-order-applied on the demo server.
//
// See PR brief "payment waterfall" — RecordPaymentModal's invoice checklist
// submits to this endpoint.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/suspensionService');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const suspensionService = require('../src/services/suspensionService');
const app = require('../src/app');

const AUTH = 'Bearer ' + jwt.sign(
  { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

const PAYMENT_ROW = { id: 1, client_id: 5, amount: '250.00', organization_id: 1 };

function makeConn() {
  return {
    beginTransaction: jest.fn(),
    execute: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
}

function invoiceRow(overrides) {
  return {
    id: 1, invoice_number: 'INV-1', contract_id: null, status: 'issued',
    total: '100.00', balance_due: '100.00', client_id: 5, organization_id: 1,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue({
    id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1,
  });
});

describe('POST /payments/:id/allocate-auto', () => {
  test('FIFO: oldest invoice fully paid, middle partially paid, newest untouched', async () => {
    const conn = makeConn();
    const invA = invoiceRow({ id: 10, invoice_number: 'INV-10', total: '100.00', balance_due: '100.00' });
    const invB = invoiceRow({ id: 11, invoice_number: 'INV-11', total: '200.00', balance_due: '200.00' });
    const invC = invoiceRow({ id: 12, invoice_number: 'INV-12', total: '500.00', balance_due: '500.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])                    // payment org-verify (amount 250.00)
      .mockResolvedValueOnce([[{ allocated: 0 }]])                // remainder = 250
      .mockResolvedValueOnce([[invA, invB, invC]])                // getInvoicesWithBalance, oldest→newest
      // invoice A: apply 100 (fully covers it)
      .mockResolvedValueOnce([{ insertId: 101 }])                 // INSERT allocation for A
      .mockResolvedValueOnce([[{ total_allocated: '100.00' }]])   // finalizeIfFullyPaid SUM for A
      .mockResolvedValueOnce([{ affectedRows: 1 }])                // UPDATE invoices → paid (A)
      // invoice B: apply remaining 150 (partial — 200 total)
      .mockResolvedValueOnce([{ insertId: 102 }])                 // INSERT allocation for B
      .mockResolvedValueOnce([[{ total_allocated: '150.00' }]]);  // finalizeIfFullyPaid SUM for B (not enough)
      // invoice C: loop breaks before touching it (remainder hits 0 after B)

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(201);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();

    // Exactly 2 INSERTs — invoice C was never touched.
    const inserts = conn.execute.mock.calls.filter(([sql]) => /INSERT INTO payment_allocations/i.test(sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual([1, 10, 100]);   // payment_id, invoice_id, amount
    expect(inserts[1][1]).toEqual([1, 11, 150]);

    // Only invoice A was flipped to 'paid'.
    const paidUpdates = conn.execute.mock.calls.filter(([sql]) => /UPDATE invoices SET status/i.test(sql));
    expect(paidUpdates).toHaveLength(1);
    expect(paidUpdates[0][1]).toEqual(['paid', 10]);

    expect(res.body.data.remaining_credit).toBe(0);
    expect(res.body.data.allocations).toEqual([
      { id: 101, payment_id: 1, invoice_id: 10, invoice_number: 'INV-10', amount: 100, fully_paid: true },
      { id: 102, payment_id: 1, invoice_id: 11, invoice_number: 'INV-11', amount: 150, fully_paid: false },
    ]);
  });

  test('custom invoice_ids subset is respected and still applied oldest→newest', async () => {
    const conn = makeConn();
    // Caller asks for [12, 10] (newest first!) but the DB query (mirroring
    // getInvoicesWithBalance's ORDER BY) always returns oldest→newest —
    // ordering within the subset must not follow the request body's order.
    const invA = invoiceRow({ id: 10, invoice_number: 'INV-10', total: '100.00', balance_due: '100.00' });
    const invC = invoiceRow({ id: 12, invoice_number: 'INV-12', total: '500.00', balance_due: '500.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{ allocated: 0 }]])
      .mockResolvedValueOnce([[invA, invC]])                       // narrowed + still oldest→newest
      .mockResolvedValueOnce([{ insertId: 201 }])                  // INSERT for A
      .mockResolvedValueOnce([[{ total_allocated: '100.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])                 // UPDATE invoices → paid (A)
      .mockResolvedValueOnce([{ insertId: 202 }])                  // INSERT for C
      .mockResolvedValueOnce([[{ total_allocated: '150.00' }]]);   // C partial (250 remainder - 100 = 150 applied)

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ invoice_ids: [12, 10] });

    expect(res.status).toBe(201);
    const inserts = conn.execute.mock.calls.filter(([sql]) => /INSERT INTO payment_allocations/i.test(sql));
    expect(inserts).toHaveLength(2);
    // A (oldest) is applied FIRST despite being second in the request body.
    expect(inserts[0][1]).toEqual([1, 10, 100]);
    expect(inserts[1][1]).toEqual([1, 12, 150]);
  });

  test('fully-covered invoice with a suspended contract triggers reconnect', async () => {
    const conn = makeConn();
    const inv = invoiceRow({ id: 20, contract_id: 7, total: '250.00', balance_due: '250.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{ allocated: 0 }]])
      .mockResolvedValueOnce([[inv]])
      .mockResolvedValueOnce([{ insertId: 301 }])
      .mockResolvedValueOnce([[{ total_allocated: '250.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    db.getConnection.mockResolvedValue(conn);
    db.query.mockResolvedValueOnce([[{ id: 7, status: 'suspended' }]]); // reconnectIfSuspended's contract lookup
    suspensionService.reconnectContract.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.allocations[0].fully_paid).toBe(true);
    expect(suspensionService.reconnectContract).toHaveBeenCalledWith(7, 1, 20);
  });

  test('leftover after covering all invoices is returned as remaining_credit', async () => {
    const conn = makeConn();
    const inv = invoiceRow({ id: 30, total: '100.00', balance_due: '100.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])                     // amount 250.00
      .mockResolvedValueOnce([[{ allocated: 0 }]])
      .mockResolvedValueOnce([[inv]])
      .mockResolvedValueOnce([{ insertId: 401 }])
      .mockResolvedValueOnce([[{ total_allocated: '100.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.remaining_credit).toBe(150);
  });

  test('over-allocation trigger on INSERT rolls back and persists nothing', async () => {
    const conn = makeConn();
    const inv = invoiceRow({ id: 40, total: '100.00', balance_due: '100.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{ allocated: 0 }]])
      .mockResolvedValueOnce([[inv]])
      .mockRejectedValueOnce(Object.assign(new Error('exceeds total'), { sqlState: '45000', errno: 1644 }));

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OVER_ALLOCATION');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    // No 'paid' flip and no reconnect attempt — nothing persisted.
    const paidUpdates = conn.execute.mock.calls.filter(([sql]) => /UPDATE invoices SET status/i.test(sql));
    expect(paidUpdates).toHaveLength(0);
    expect(suspensionService.reconnectContract).not.toHaveBeenCalled();
  });

  test('a duplicate live allocation (UNIQUE collision) is skipped, not fatal', async () => {
    const conn = makeConn();
    const invA = invoiceRow({ id: 50, total: '100.00', balance_due: '100.00' });
    const invB = invoiceRow({ id: 51, total: '150.00', balance_due: '150.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{ allocated: 0 }]])
      .mockResolvedValueOnce([[invA, invB]])
      .mockRejectedValueOnce(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 }))
      .mockResolvedValueOnce([{ insertId: 502 }])                  // B still gets inserted
      .mockResolvedValueOnce([[{ total_allocated: '150.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(201);
    expect(conn.commit).toHaveBeenCalled();
    expect(res.body.data.allocations).toHaveLength(1);
    expect(res.body.data.allocations[0].invoice_id).toBe(51);
  });

  test('a zero-balance invoice among the target set is skipped, not applied to', async () => {
    const conn = makeConn();
    const alreadyCovered = invoiceRow({ id: 60, total: '100.00', balance_due: '0.00' });
    const stillOwed = invoiceRow({ id: 61, total: '80.00', balance_due: '80.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{ allocated: 0 }]])
      .mockResolvedValueOnce([[alreadyCovered, stillOwed]])
      .mockResolvedValueOnce([{ insertId: 601 }])                  // only ONE insert — for invoice 61
      .mockResolvedValueOnce([[{ total_allocated: '80.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(201);
    const inserts = conn.execute.mock.calls.filter(([sql]) => /INSERT INTO payment_allocations/i.test(sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual([1, 61, 80]);
  });

  test('returns 404 when the payment does not belong to this org', async () => {
    const conn = makeConn();
    conn.execute.mockResolvedValueOnce([[]]); // no payment row

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('rejects an invoice_ids entry that is missing / cross-org / not payable', async () => {
    const conn = makeConn();
    const invA = invoiceRow({ id: 70, total: '100.00', balance_due: '100.00' });

    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])
      .mockResolvedValueOnce([[{ allocated: 0 }]])
      // Requested [70, 9999] but only 70 comes back — 9999 is some other
      // org's invoice, a different client's invoice, or void/cancelled/paid.
      .mockResolvedValueOnce([[invA]]);

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ invoice_ids: [70, 9999] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    expect(res.body.error.message).toContain('9999');
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('rejects a payment with no remaining balance to allocate', async () => {
    const conn = makeConn();
    conn.execute
      .mockResolvedValueOnce([[PAYMENT_ROW]])              // amount 250.00
      .mockResolvedValueOnce([[{ allocated: 250 }]]);       // already fully allocated

    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYMENT_FULLY_ALLOCATED');
    expect(conn.rollback).toHaveBeenCalled();
  });

  test.each([
    [[]],
    [['abc']],
    [[1.5]],
    [[-1]],
    [[0]],
  ])('rejects a malformed invoice_ids body: %j', async (invoice_ids) => {
    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ invoice_ids });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .post('/api/v1/payments/1/allocate-auto')
      .send({});
    expect(res.status).toBe(401);
  });
});
