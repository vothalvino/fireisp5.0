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
    // Narrowed from 'FROM organizations' to the CURRENCY read specifically.
    // The create path now also resolves tax coherence, and that reads
    // 'SELECT locale FROM organizations' for the error wording — a different
    // question against the same table. The assertion here is about currency
    // defaulting being short-circuited, not about the table being untouched.
    expect(db.query.mock.calls.some((c) => c[0].includes('SELECT currency FROM organizations'))).toBe(false);
    const ledgerInsert = db.query.mock.calls.find((c) => c[0].includes('INSERT INTO client_balance_ledger'));
    expect(ledgerInsert[1]).toContain('EUR');
  });
});

// =============================================================================
// Totals-consistency guard — subtotal + tax must equal total at CREATE/UPDATE
// (the note's total drives the balance ledger + the CFDI de Egreso; before this
// guard an inconsistent note polluted the books and only failed at stamp time)
// =============================================================================
describe('credit note totals-consistency guard', () => {
  test('POST rejects subtotal + tax ≠ total with 422 and writes NOTHING', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/credit-notes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ client_id: 9, invoice_id: 7, subtotal: 100, tax_amount: 16, total: 300 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CREDIT_NOTE_TOTALS_INCONSISTENT');
    expect(db.query.mock.calls.some((c) => c[0].includes('INSERT INTO'))).toBe(false); // no note, no ledger credit
  });

  test('POST accepts consistent amounts (100 + 16 = 116)', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (sql.includes('FROM invoices WHERE id')) return Promise.resolve([[{ currency: 'MXN' }]]);
      if (sql.includes('INSERT INTO `credit_notes`') || sql.includes('INSERT INTO credit_notes')) return Promise.resolve([{ insertId: 8 }]);
      if (sql.includes('FROM `credit_notes`') || sql.includes('FROM credit_notes')) {
        return Promise.resolve([[{ id: 8, client_id: 9, invoice_id: 7, total: '116.00', currency: 'MXN', credit_note_number: 'CN-0004' }]]);
      }
      if (sql.includes('INSERT INTO client_balance_ledger')) return Promise.resolve([{ insertId: 4 }]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/credit-notes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ client_id: 9, invoice_id: 7, subtotal: 100, tax_amount: 16, total: 116 });

    expect(res.status).toBe(201);
  });

  test('POST with only a total (refund-path shape) is coherent and passes', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (sql.includes('FROM organizations')) return Promise.resolve([[{ currency: 'MXN' }]]);
      if (sql.includes('INSERT INTO `credit_notes`') || sql.includes('INSERT INTO credit_notes')) return Promise.resolve([{ insertId: 9 }]);
      if (sql.includes('FROM `credit_notes`') || sql.includes('FROM credit_notes')) {
        return Promise.resolve([[{ id: 9, client_id: 9, invoice_id: null, total: '75.00', currency: 'MXN', credit_note_number: 'CN-0005' }]]);
      }
      if (sql.includes('INSERT INTO client_balance_ledger')) return Promise.resolve([{ insertId: 5 }]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/credit-notes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ client_id: 9, total: 75 });

    expect(res.status).toBe(201);
  });

  test('PUT that changes ONE amount cannot sneak the merged row inconsistent', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (sql.includes('FROM `credit_notes`') || sql.includes('FROM credit_notes')) {
        // existing consistent row 100 + 16 = 116
        return Promise.resolve([[{ id: 8, client_id: 9, subtotal: '100.00', tax_amount: '16.00', total: '116.00', status: 'draft' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .put('/api/v1/credit-notes/8')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ total: 500 }); // 100 + 16 ≠ 500

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CREDIT_NOTE_TOTALS_INCONSISTENT');
    expect(db.query.mock.calls.some((c) => c[0].includes('UPDATE `credit_notes`') || c[0].includes('UPDATE credit_notes'))).toBe(false);
  });

  test('PUT can deliberately FIX an inconsistent legacy row', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (sql.includes('UPDATE `credit_notes`') || sql.includes('UPDATE credit_notes')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('FROM `credit_notes`') || sql.includes('FROM credit_notes')) {
        // legacy inconsistent row 100 + 16 = 300; the PUT corrects total to 116
        return Promise.resolve([[{ id: 10, client_id: 9, subtotal: '100.00', tax_amount: '16.00', total: '300.00', status: 'draft' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .put('/api/v1/credit-notes/10')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ total: 116 });

    expect(res.status).toBe(200);
  });
});
