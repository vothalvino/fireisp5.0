// =============================================================================
// FireISP 5.0 — Portal Dashboard balance (PR "balance-computed-currency-org")
// =============================================================================
// GET /portal/dashboard's "Outstanding balance" used to be a plain
// SUM(total) of unpaid invoices — it overstated what the client owed
// whenever an invoice had a partial payment allocated to it, and never
// credited an unapplied overpayment. It now uses the same computed,
// org-scoped balance (invoices + payments) shown everywhere else — see
// src/services/clientBalanceService.js.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock.access.token'),
  verify: jest.fn(),
}));

const request = require('supertest');
const db = require('../src/config/database');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/portal/dashboard — balance', () => {
  test('returns the computed balance + currency, not a plain SUM(total) of unpaid invoices', async () => {
    jwt.verify.mockReturnValue({ sub: 1, orgId: 5, type: 'portal' });
    db.query.mockImplementation((sql) => {
      // portalAuthenticate's client lookup
      if (/FROM clients WHERE id = \?/.test(sql)) {
        return Promise.resolve([[{ id: 1, organization_id: 5, name: 'Alice', email: 'alice@example.com', status: 'active' }]]);
      }
      // active contract + plan
      if (/FROM contracts c/.test(sql) && /JOIN plans/.test(sql)) {
        return Promise.resolve([[]]);
      }
      // computeClientBalance: getInvoicesWithBalance — total 200, 150 already
      // allocated -> balance_due 50
      if (/FROM invoices i/.test(sql)) {
        return Promise.resolve([[{ id: 9, total: '200.00', currency: 'MXN', balance_due: '50.00' }]]);
      }
      // computeClientBalance: payments — none unallocated
      if (/FROM payments p/.test(sql)) {
        return Promise.resolve([[]]);
      }
      // next-due lookup
      if (/FROM invoices\s+WHERE client_id/.test(sql)) {
        return Promise.resolve([[{ next_due: null }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/portal/dashboard')
      .set('Authorization', 'Bearer portal.valid');

    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(50); // NOT the old 200 (invoice total, ignoring the allocation)
    expect(res.body.data.balance_currency).toBe('MXN');
  });
});
