// =============================================================================
// FireISP 5.0 — Payment → auto-reconnect (POST /payments/:id/allocate)
// =============================================================================
// The worst symptom of the suspension_logs column drift: allocating a payment
// that fully pays a suspended contract's invoice marked the invoice PAID and
// *then* threw inside suspensionService.reconnectContract — so the customer had
// paid, the invoice said paid, and the service stayed suspended. Reproduced live
// on the demo server before the fix.
//
// This test drives the real route through the real service with a mocked driver,
// so the INSERT is executed for real against the mock and a bad column list shows
// up as an assertion failure here rather than a 500 in production.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

const AUTH = 'Bearer ' + jwt.sign(
  { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

const SUSPENDED_INVOICE = {
  id: 50, client_id: 5, contract_id: 10, status: 'issued', total: '500.00', organization_id: 1,
};

describe('POST /payments/:id/allocate → auto-reconnect of a suspended contract', () => {
  let conn;

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue({
      id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1,
    });

    conn = {
      beginTransaction: jest.fn(),
      execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    db.query.mockImplementation((sql) => {
      if (/FROM payments/i.test(sql)) {
        return [[{ id: 1, client_id: 5, amount: '500.00', organization_id: 1 }]];
      }
      if (/FROM invoices/i.test(sql)) return [[SUSPENDED_INVOICE]];
      if (/INSERT INTO payment_allocations/i.test(sql)) return [{ insertId: 99 }];
      if (/FROM payment_allocations WHERE id/i.test(sql)) {
        return [[{ id: 99, payment_id: 1, invoice_id: 50, amount: '500.00' }]];
      }
      if (/SUM\(amount\)/i.test(sql)) return [[{ total_allocated: '500.00' }]];
      if (/UPDATE invoices/i.test(sql)) return [{ affectedRows: 1 }];
      // the contract is suspended → triggers the reconnect
      if (/FROM contracts/i.test(sql)) return [[{ id: 10, client_id: 5, status: 'suspended' }]];
      if (/FROM radius/i.test(sql)) return [[]];                       // no RADIUS account
      if (/FROM suspension_logs/i.test(sql)) return [[]];              // no open walled garden
      return [[]];
    });
  });

  test('allocation fully paying the invoice reconnects the contract without throwing', async () => {
    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ invoice_id: 50, amount: 500 });

    // Before the fix this was a 500 — invoice already flipped to paid, customer
    // still suspended.
    expect(res.status).toBe(201);

    // The invoice was marked paid...
    const paidInvoice = db.query.mock.calls.find(([sql]) => /UPDATE invoices SET status/i.test(sql));
    expect(paidInvoice).toBeDefined();
    expect(paidInvoice[1]).toContain('paid');

    // ...and the contract was actually reconnected, in a transaction.
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();

    const contractUpdate = conn.execute.mock.calls.find(([sql]) => /UPDATE contracts SET status/i.test(sql));
    expect(contractUpdate[1]).toEqual(['active', 10]);

    const radiusUpdate = conn.execute.mock.calls.find(([sql]) => /UPDATE radius SET status/i.test(sql));
    expect(radiusUpdate[0]).toContain("'active'");

    // The suspension_logs row is written with the real columns.
    const [logSql, logParams] = conn.execute.mock.calls
      .find(([sql]) => /INSERT INTO suspension_logs/i.test(sql));
    expect(logSql).toContain('performed_by_user_id');
    expect(logSql).toContain('radius_coa_sent');
    expect(logSql).toContain('related_invoice_id');
    expect(logSql).toContain('client_id');
    expect(logSql).toMatch(/'unsuspended'/);
    expect(logParams).toContain(50);          // related_invoice_id = the paid invoice
    expect(logParams).toContain(1);           // performed_by_user_id = the staff user
    expect(logParams).toContain('manual');    // a user did it
  });

  test('an unsuspended contract is left alone', async () => {
    db.query.mockImplementation((sql) => {
      if (/FROM payments/i.test(sql)) return [[{ id: 1, client_id: 5, amount: '500.00', organization_id: 1 }]];
      if (/FROM invoices/i.test(sql)) return [[SUSPENDED_INVOICE]];
      if (/INSERT INTO payment_allocations/i.test(sql)) return [{ insertId: 99 }];
      if (/FROM payment_allocations WHERE id/i.test(sql)) return [[{ id: 99 }]];
      if (/SUM\(amount\)/i.test(sql)) return [[{ total_allocated: '500.00' }]];
      if (/UPDATE invoices/i.test(sql)) return [{ affectedRows: 1 }];
      if (/FROM contracts/i.test(sql)) return [[]];      // not suspended
      return [[]];
    });

    const res = await request(app)
      .post('/api/v1/payments/1/allocate')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ invoice_id: 50, amount: 500 });

    expect(res.status).toBe(201);
    expect(db.getConnection).not.toHaveBeenCalled();
  });
});
