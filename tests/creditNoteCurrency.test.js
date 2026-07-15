// =============================================================================
// FireISP 5.0 — Credit Note currency defaulting (PR "balance-computed-currency-org")
// =============================================================================
// POST /api/v1/credit-notes used to leave `currency` unset when the caller
// omitted it, letting the DB column default ('USD') silently win regardless
// of the organization's real currency. It now defaults to the linked
// invoice's own currency when invoice_id is given, else the organization's
// currency — never a hardcoded 'USD'. An explicitly-set currency always wins.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken(orgId = 1) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function isUserLookup(sql) {
  return typeof sql === 'string' && sql.includes('`users`');
}
const ADMIN_USER_ROW = { id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 };

beforeEach(() => jest.clearAllMocks());

describe('POST /api/v1/credit-notes — currency defaulting', () => {
  test('defaults to the linked invoice\'s own currency when invoice_id is given', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (sql.includes('FROM invoices WHERE id')) return Promise.resolve([[{ currency: 'MXN' }]]);
      if (sql.includes('INSERT INTO `credit_notes`') || sql.includes('INSERT INTO credit_notes')) return Promise.resolve([{ insertId: 5 }]);
      if (sql.includes('FROM `credit_notes`') || sql.includes('FROM credit_notes')) {
        return Promise.resolve([[{ id: 5, client_id: 9, invoice_id: 7, total: '100.00', currency: 'MXN', credit_note_number: 'CN-0001' }]]);
      }
      if (sql.includes('INSERT INTO client_balance_ledger')) return Promise.resolve([{ insertId: 1 }]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/credit-notes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ client_id: 9, invoice_id: 7, total: 100 });

    expect(res.status).toBe(201);
    const ledgerInsert = db.query.mock.calls.find((c) => c[0].includes('INSERT INTO client_balance_ledger'));
    expect(ledgerInsert[1]).toContain('MXN');
    // The invoice's currency was looked up org-scoped.
    const invoiceLookup = db.query.mock.calls.find((c) => c[0].includes('FROM invoices WHERE id'));
    expect(invoiceLookup[1]).toEqual([7, 1]);
  });

  test('defaults to the organization currency when there is no invoice_id', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (sql.includes('FROM organizations')) return Promise.resolve([[{ currency: 'MXN' }]]);
      if (sql.includes('INSERT INTO `credit_notes`') || sql.includes('INSERT INTO credit_notes')) return Promise.resolve([{ insertId: 6 }]);
      if (sql.includes('FROM `credit_notes`') || sql.includes('FROM credit_notes')) {
        return Promise.resolve([[{ id: 6, client_id: 9, invoice_id: null, total: '50.00', currency: 'MXN', credit_note_number: 'CN-0002' }]]);
      }
      if (sql.includes('INSERT INTO client_balance_ledger')) return Promise.resolve([{ insertId: 2 }]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/credit-notes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ client_id: 9, total: 50 });

    expect(res.status).toBe(201);
    const ledgerInsert = db.query.mock.calls.find((c) => c[0].includes('INSERT INTO client_balance_ledger'));
    expect(ledgerInsert[1]).toContain('MXN');
  });

  test('an explicitly-set currency always wins — no invoice/org lookup happens', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (sql.includes('INSERT INTO `credit_notes`') || sql.includes('INSERT INTO credit_notes')) return Promise.resolve([{ insertId: 7 }]);
      if (sql.includes('FROM `credit_notes`') || sql.includes('FROM credit_notes')) {
        return Promise.resolve([[{ id: 7, client_id: 9, invoice_id: 7, total: '100.00', currency: 'EUR', credit_note_number: 'CN-0003' }]]);
      }
      if (sql.includes('INSERT INTO client_balance_ledger')) return Promise.resolve([{ insertId: 3 }]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/credit-notes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ client_id: 9, invoice_id: 7, total: 100, currency: 'EUR' });

    expect(res.status).toBe(201);
    expect(db.query.mock.calls.some((c) => c[0].includes('FROM invoices WHERE id'))).toBe(false);
    expect(db.query.mock.calls.some((c) => c[0].includes('FROM organizations'))).toBe(false);
    const ledgerInsert = db.query.mock.calls.find((c) => c[0].includes('INSERT INTO client_balance_ledger'));
    expect(ledgerInsert[1]).toContain('EUR');
  });
});
