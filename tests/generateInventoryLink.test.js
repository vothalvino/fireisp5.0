// =============================================================================
// FireISP 5.0 — Generate carries inventory link (last inventory-drawdown gap)
// =============================================================================
// POST /invoices/generate and POST /quotes/generate now accept an optional
// inventory_item_id on `type: 'product'` line items:
//   - /invoices/generate: org-verifies the item, enforces an integer
//     quantity, and draws down stock (src/services/inventoryDrawdownService.js)
//     on the SAME connection/transaction as the invoice + item INSERTs — a
//     failed drawdown rolls back the whole generate.
//   - /quotes/generate: same acceptance/validation, carried into quote_items,
//     but NO drawdown at quote stage (only conversion to an invoice draws
//     down — see tests/inventoryPhase2ProductLinkage.test.js).
// `type: 'custom'`/'contract' items are untouched even if inventory_item_id
// is sent on them.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');
const billingService = require('../src/services/billingService');

function adminToken(orgId = 10) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

// Matches the authenticate() -> User.findById() lookup precisely (backtick
// table name), so it never collides with any other `WHERE id = ?` query this
// test file's routes also issue.
function isUserLookup(sql) {
  return typeof sql === 'string' && sql.includes('`users`');
}
const ADMIN_USER_ROW = { id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 };

function buildConn() {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(),
    query: jest.fn(),
  };
}

afterEach(() => { jest.clearAllMocks(); });

// ---------------------------------------------------------------------------
// POST /api/v1/invoices/generate
// ---------------------------------------------------------------------------
describe('POST /api/v1/invoices/generate — inventory_item_id on product lines', () => {
  it('decrements stock and writes a sell_to_client ledger row in the SAME transaction as the invoice', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) return Promise.resolve([[{ id: 7 }]]);
      if (typeof sql === 'string' && sql.includes('FROM tax_rates WHERE organization_id')) return Promise.resolve([[]]);
      if (typeof sql === 'string' && sql.includes('`invoices`')) return Promise.resolve([[{ id: 42, invoice_number: 'INV-000009' }]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ insertId: 42 }]);
      if (sql.includes('INSERT INTO invoice_items')) return Promise.resolve([{ insertId: 501 }]);
      if (sql.includes('SELECT s.id FROM inventory_stock s')) return Promise.resolve([[{ id: 55 }]]);
      if (sql.includes('UPDATE inventory_stock SET quantity')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('INSERT INTO inventory_transactions')) return Promise.resolve([{ insertId: 900 }]);
      if (sql.includes('INSERT INTO client_balance_ledger')) return Promise.resolve([{ insertId: 1 }]);
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    });
    db.getConnection.mockResolvedValue(conn);

    // nextInvoiceNumber issues its own INSERT IGNORE/UPDATE/SELECT
    // LAST_INSERT_ID() SQL shape that isn't the point of this test — stub it
    // directly (same pattern as tests/inventoryPhase2ProductLinkage.test.js).
    jest.spyOn(billingService, 'nextInvoiceNumber').mockResolvedValue('INV-000009');

    const res = await request(app)
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'product', description: 'Router', quantity: 2, unit_price: 500, inventory_item_id: 7 }],
      });

    expect(res.status).toBe(201);
    expect(conn.commit).toHaveBeenCalled();

    const itemInsertCall = conn.execute.mock.calls.find((c) => c[0].includes('INSERT INTO invoice_items'));
    // invoice_id, description, quantity, unit_price, amount, inventory_item_id
    expect(itemInsertCall[1]).toEqual([42, 'Router', 2, 500, 1000, 7]);

    // No warehouse-fallback INSERT — the greatest-quantity row already existed.
    expect(conn.execute.mock.calls.some((c) => c[0].includes('INSERT INTO inventory_stock'))).toBe(false);

    const stockUpdateCall = conn.execute.mock.calls.find((c) => c[0].includes('UPDATE inventory_stock SET quantity'));
    expect(stockUpdateCall[1]).toEqual([2, 55]);

    const ledgerCall = conn.execute.mock.calls.find((c) => c[0].includes('INSERT INTO inventory_transactions'));
    // stock_id, quantity, unit_price, client_id, invoice_id, performed_by, reference
    expect(ledgerCall[1]).toEqual([55, 2, 500, 5, 42, 1, 'INV-000009']);
    expect(ledgerCall[0]).toMatch(/'sell_to_client'/);
  });

  it('rolls back the WHOLE generate (invoice + items + stock) when the drawdown fails', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) return Promise.resolve([[{ id: 7 }]]);
      if (typeof sql === 'string' && sql.includes('FROM tax_rates WHERE organization_id')) return Promise.resolve([[]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ insertId: 42 }]);
      if (sql.includes('INSERT INTO invoice_items')) return Promise.resolve([{ insertId: 501 }]);
      if (sql.includes('SELECT s.id FROM inventory_stock s')) return Promise.resolve([[]]); // no stock anywhere
      if (sql.includes('SELECT id FROM warehouses WHERE')) return Promise.resolve([[]]); // no warehouse configured
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    });
    db.getConnection.mockResolvedValue(conn);

    jest.spyOn(billingService, 'nextInvoiceNumber').mockResolvedValue('INV-000010');

    const res = await request(app)
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'product', description: 'Router', quantity: 1, unit_price: 500, inventory_item_id: 7 }],
      });

    expect(res.status).toBe(422);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    // Stock was never decremented — the failure happened before that write.
    expect(conn.execute.mock.calls.some((c) => c[0].includes('UPDATE inventory_stock SET quantity'))).toBe(false);
  });

  it('returns 422 when quantity is fractional and inventory_item_id is set on a product line', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'product', description: 'Router', quantity: 1.5, unit_price: 500, inventory_item_id: 7 }],
      });

    expect(res.status).toBe(422);
    // Fails before ever opening a transaction or looking up the item.
    expect(db.getConnection).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('FROM inventory_items WHERE id'))).toBe(false);
  });

  it('returns 422 when inventory_item_id belongs to another organization', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) return Promise.resolve([[]]); // cross-org / nonexistent
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'product', description: 'Router', quantity: 1, unit_price: 500, inventory_item_id: 999 }],
      });

    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('leaves a custom (free-text) item unlinked even if inventory_item_id is sent on it', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      if (typeof sql === 'string' && sql.includes('FROM tax_rates WHERE organization_id')) return Promise.resolve([[]]);
      if (typeof sql === 'string' && sql.includes('`invoices`')) return Promise.resolve([[{ id: 42 }]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ insertId: 42 }]);
      if (sql.includes('INSERT INTO invoice_items')) return Promise.resolve([{ insertId: 501 }]);
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    });
    db.getConnection.mockResolvedValue(conn);

    jest.spyOn(billingService, 'nextInvoiceNumber').mockResolvedValue('INV-000011');

    const res = await request(app)
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'custom', description: 'Installation fee', quantity: 1, unit_price: 100, inventory_item_id: 7 }],
      });

    expect(res.status).toBe(201);
    // 'custom' items never look at inventory_item_id — no org lookup, no drawdown.
    expect(db.query.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('FROM inventory_items WHERE id'))).toBe(false);
    const itemInsertCall = conn.execute.mock.calls.find((c) => c[0].includes('INSERT INTO invoice_items'));
    expect(itemInsertCall[1]).toEqual([42, 'Installation fee', 1, 100, 100, null]);
    expect(conn.execute.mock.calls.some((c) => c[0].includes('UPDATE inventory_stock SET quantity'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/quotes/generate — carries the link, NEVER draws down
// ---------------------------------------------------------------------------
describe('POST /api/v1/quotes/generate — inventory_item_id on product lines (no drawdown)', () => {
  it('carries inventory_item_id into quote_items with zero stock/ledger writes', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) return Promise.resolve([[{ id: 7 }]]);
      if (typeof sql === 'string' && sql.includes('FROM tax_rates WHERE organization_id')) return Promise.resolve([[]]);
      if (typeof sql === 'string' && sql.includes('`quotes`')) return Promise.resolve([[{ id: 9, quote_number: 'QUO-000005' }]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO quotes')) return Promise.resolve([{ insertId: 9 }]);
      if (sql.includes('INSERT INTO quote_items')) return Promise.resolve([{ insertId: 61 }]);
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    });
    db.getConnection.mockResolvedValue(conn);

    jest.spyOn(billingService, 'nextQuoteNumber').mockResolvedValue('QUO-000005');

    const res = await request(app)
      .post('/api/v1/quotes/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'product', description: 'Router', quantity: 2, unit_price: 500, inventory_item_id: 7 }],
      });

    expect(res.status).toBe(201);
    expect(conn.commit).toHaveBeenCalled();

    const itemInsertCall = conn.execute.mock.calls.find((c) => c[0].includes('INSERT INTO quote_items'));
    // quote_id, description, quantity, unit_price, inventory_item_id
    expect(itemInsertCall[1]).toEqual([9, 'Router', 2, 500, 7]);

    // No drawdown at quote-generation time — quotes never draw down stock.
    expect(conn.execute.mock.calls.some((c) => c[0].includes('UPDATE inventory_stock SET quantity'))).toBe(false);
    expect(conn.execute.mock.calls.some((c) => c[0].includes('INSERT INTO inventory_transactions'))).toBe(false);
    expect(conn.execute.mock.calls.some((c) => c[0].includes('SELECT s.id FROM inventory_stock s'))).toBe(false);
  });

  it('returns 422 when quantity is fractional and inventory_item_id is set on a product line', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'product', description: 'Router', quantity: 1.5, unit_price: 500, inventory_item_id: 7 }],
      });

    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('FROM inventory_items WHERE id'))).toBe(false);
  });

  it('returns 422 when inventory_item_id belongs to another organization', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) return Promise.resolve([[]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'product', description: 'Router', quantity: 1, unit_price: 500, inventory_item_id: 999 }],
      });

    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('leaves a custom (free-text) item unlinked even if inventory_item_id is sent on it', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM clients WHERE id')) return Promise.resolve([[{ id: 5 }]]);
      if (typeof sql === 'string' && sql.includes('FROM tax_rates WHERE organization_id')) return Promise.resolve([[]]);
      if (typeof sql === 'string' && sql.includes('`quotes`')) return Promise.resolve([[{ id: 9 }]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO quotes')) return Promise.resolve([{ insertId: 9 }]);
      if (sql.includes('INSERT INTO quote_items')) return Promise.resolve([{ insertId: 61 }]);
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    });
    db.getConnection.mockResolvedValue(conn);

    jest.spyOn(billingService, 'nextQuoteNumber').mockResolvedValue('QUO-000006');

    const res = await request(app)
      .post('/api/v1/quotes/generate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({
        client_id: 5,
        items: [{ type: 'custom', description: 'Site survey', quantity: 1, unit_price: 100, inventory_item_id: 7 }],
      });

    expect(res.status).toBe(201);
    expect(db.query.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('FROM inventory_items WHERE id'))).toBe(false);
    const itemInsertCall = conn.execute.mock.calls.find((c) => c[0].includes('INSERT INTO quote_items'));
    expect(itemInsertCall[1]).toEqual([9, 'Site survey', 1, 100, null]);
  });
});
