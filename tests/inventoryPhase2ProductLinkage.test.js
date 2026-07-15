// =============================================================================
// FireISP 5.0 — Inventory Phase 2: product linkage + sale drawdown tests
// =============================================================================
// Covers migration 390's plan_addons/invoice_items/quote_items.inventory_item_id
// linkage: catalog quantity_on_hand surfacing, org-ownership validation,
// automatic sale drawdown on POST /invoices/:id/items, drawdown-exactly-once
// on quote->invoice conversion, and the new GET /inventory/transactions
// ledger read API.
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

function adminToken(orgId = 10) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

// Matches the authenticate() -> User.findById() lookup precisely (backtick
// table name), so it never collides with any other `WHERE id = ?` query this
// test file's routes also issue (invoices, quotes, inventory_items, ...).
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
  };
}

afterEach(() => { jest.clearAllMocks(); });

// ---------------------------------------------------------------------------
// GET /api/v1/plans/addons/catalog — quantity_on_hand surfacing
// ---------------------------------------------------------------------------
describe('GET /api/v1/plans/addons/catalog', () => {
  it('returns quantity_on_hand for inventory-linked addons', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM plan_addons pa')) {
        return Promise.resolve([[
          { id: 1, name: 'Router Rental', inventory_item_id: 7, price: '50.00', quantity_on_hand: 14 },
          { id: 2, name: 'Static IP', inventory_item_id: null, price: '30.00', quantity_on_hand: 0 },
        ]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/plans/addons/catalog')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ inventory_item_id: 7, quantity_on_hand: 14 });

    // Single grouped query — no N+1 per-addon stock lookup.
    const catalogCalls = db.query.mock.calls.filter(c => typeof c[0] === 'string' && c[0].includes('plan_addons pa'));
    expect(catalogCalls).toHaveLength(1);
    expect(catalogCalls[0][0]).toMatch(/LEFT JOIN inventory_stock/);
    expect(catalogCalls[0][0]).toMatch(/GROUP BY pa\.id/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/plans/addons — inventory_item_id persistence + org-ownership
// ---------------------------------------------------------------------------
describe('POST /api/v1/plans/addons', () => {
  it('persists inventory_item_id when the referenced item belongs to this org', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) {
        return Promise.resolve([[{ id: 7 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO plan_addons')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT * FROM plan_addons WHERE id')) {
        return Promise.resolve([[{ id: 99, inventory_item_id: 7, name: 'Router Rental' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/plans/addons')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Router Rental', addon_type: 'equipment_rental', price: 50, inventory_item_id: 7 });

    expect(res.status).toBe(201);
    const insertCall = db.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO plan_addons'));
    expect(insertCall[1]).toEqual([10, 'Router Rental', 'equipment_rental', 7, 50, undefined, true, 'active']);
  });

  it('returns 422 when inventory_item_id does not belong to this org', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) {
        return Promise.resolve([[]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/plans/addons')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Router Rental', addon_type: 'equipment_rental', price: 50, inventory_item_id: 999 });

    expect(res.status).toBe(422);
    const insertCall = db.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO plan_addons'));
    expect(insertCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/invoices/:id/items — sale drawdown
// ---------------------------------------------------------------------------
describe('POST /api/v1/invoices/:id/items — inventory-linked sale drawdown', () => {
  it('decrements the largest stock row and writes a sell_to_client ledger row', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 42, client_id: 77, invoice_number: 'INV-000005' }]]);
      }
      if (sql.includes('FROM inventory_items WHERE id')) {
        return Promise.resolve([[{ id: 7 }]]);
      }
      if (sql.includes('INSERT INTO invoice_items')) {
        return Promise.resolve([{ insertId: 501 }]);
      }
      if (sql.includes('SELECT * FROM invoice_items WHERE id')) {
        return Promise.resolve([[{ id: 501, description: 'Router', inventory_item_id: 7 }]]);
      }
      if (sql.includes('SELECT s.id FROM inventory_stock s')) {
        return Promise.resolve([[{ id: 55 }]]); // existing, greatest-quantity stock row
      }
      if (sql.includes('UPDATE inventory_stock SET quantity')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql.includes('INSERT INTO inventory_transactions')) {
        return Promise.resolve([{ insertId: 900 }]);
      }
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 2, unit_price: 500, amount: 1000, inventory_item_id: 7 });

    expect(res.status).toBe(201);
    expect(conn.commit).toHaveBeenCalled();

    // No warehouse-fallback INSERT — the greatest-quantity row already existed.
    expect(conn.execute.mock.calls.some(c => c[0].includes('INSERT INTO inventory_stock'))).toBe(false);

    const stockUpdateCall = conn.execute.mock.calls.find(c => c[0].includes('UPDATE inventory_stock SET quantity'));
    expect(stockUpdateCall[1]).toEqual([2, 55]);
    // No floor/guard clause — negative stock is allowed (migration 390 drops
    // the migration-127 guard trigger specifically so this never throws).
    expect(stockUpdateCall[0]).not.toMatch(/WHERE.*quantity\s*[><=]/i);

    const ledgerCall = conn.execute.mock.calls.find(c => c[0].includes('INSERT INTO inventory_transactions'));
    // stock_id, quantity, unit_price, client_id, invoice_id, performed_by, reference
    expect(ledgerCall[1]).toEqual([55, 2, 500, 77, 42, 1, 'INV-000005']);
    expect(ledgerCall[0]).toMatch(/'sell_to_client'/);
  });

  it('creates a stock row at the org\'s first warehouse when the item has no stock anywhere', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 42, client_id: 77, invoice_number: 'INV-000005' }]]);
      }
      if (sql.includes('FROM inventory_items WHERE id')) {
        return Promise.resolve([[{ id: 7 }]]);
      }
      if (sql.includes('INSERT INTO invoice_items')) {
        return Promise.resolve([{ insertId: 501 }]);
      }
      if (sql.includes('SELECT * FROM invoice_items WHERE id')) {
        return Promise.resolve([[{ id: 501 }]]);
      }
      if (sql.includes('SELECT s.id FROM inventory_stock s')) {
        return Promise.resolve([[]]); // no stock anywhere for this item
      }
      if (sql.includes('SELECT id FROM warehouses WHERE')) {
        return Promise.resolve([[{ id: 3 }]]); // org's first warehouse
      }
      if (sql.includes('INSERT INTO inventory_stock')) {
        return Promise.resolve([{ insertId: 88 }]);
      }
      if (sql.includes('UPDATE inventory_stock SET quantity')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql.includes('INSERT INTO inventory_transactions')) {
        return Promise.resolve([{ insertId: 900 }]);
      }
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1, unit_price: 500, amount: 500, inventory_item_id: 7 });

    expect(res.status).toBe(201);
    const newStockCall = conn.execute.mock.calls.find(c => c[0].includes('INSERT INTO inventory_stock'));
    expect(newStockCall[1]).toEqual([7, 3]);
    const stockUpdateCall = conn.execute.mock.calls.find(c => c[0].includes('UPDATE inventory_stock SET quantity'));
    expect(stockUpdateCall[1]).toEqual([1, 88]);
  });

  it('returns 422 when inventory_item_id belongs to another organization', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 42, client_id: 77, invoice_number: 'INV-000005' }]]);
      }
      if (sql.includes('FROM inventory_items WHERE id')) {
        return Promise.resolve([[]]); // cross-org / nonexistent
      }
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1, unit_price: 500, amount: 500, inventory_item_id: 999 });

    expect(res.status).toBe(422);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('returns 404 when the invoice does not belong to this org', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('FROM invoices WHERE id')) return Promise.resolve([[]]);
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/invoices/999/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1, unit_price: 500, amount: 500, inventory_item_id: 7 });

    expect(res.status).toBe(404);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('does not open a transaction for a plain (non-inventory) line item', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 42, status: 'issued' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO invoice_items')) {
        return Promise.resolve([{ insertId: 501 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT * FROM invoice_items WHERE id')) {
        return Promise.resolve([[{ id: 501, description: 'Setup Fee' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Setup Fee', quantity: 1, unit_price: 50, amount: 50 });

    expect(res.status).toBe(201);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('returns 422 when quantity is fractional and inventory_item_id is set', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1.5, unit_price: 500, amount: 750, inventory_item_id: 7 });

    expect(res.status).toBe(422);
    // Fails before ever opening a transaction — no wasted DB round-trip.
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('allows a fractional quantity on a free-text (non-inventory) line item', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 42, status: 'issued' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO invoice_items')) {
        return Promise.resolve([{ insertId: 501 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT * FROM invoice_items WHERE id')) {
        return Promise.resolve([[{ id: 501, description: 'Labor (1.5 hrs)' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Labor (1.5 hrs)', quantity: 1.5, unit_price: 100, amount: 150 });

    expect(res.status).toBe(201);
  });

  it('returns 422 INVOICE_VOID when adding a plain line item to a void invoice', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 42, status: 'void' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Setup Fee', quantity: 1, unit_price: 50, amount: 50 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_VOID');
    const insertCall = db.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO invoice_items'));
    expect(insertCall).toBeUndefined();
  });

  it('returns 422 INVOICE_VOID when adding an inventory-linked line item to a void invoice', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 42, client_id: 77, invoice_number: 'INV-000005', status: 'void' }]]);
      }
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/invoices/42/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1, unit_price: 500, amount: 500, inventory_item_id: 7 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_VOID');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    // Never even reached the inventory-item org-ownership lookup.
    expect(conn.execute.mock.calls.some(c => c[0].includes('FROM inventory_items WHERE id'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/quotes/:id/items — org-ownership validation only (no drawdown)
// ---------------------------------------------------------------------------
describe('POST /api/v1/quotes/:id/items — inventory_item_id', () => {
  it('persists inventory_item_id without touching stock', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) {
        return Promise.resolve([[{ id: 7 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO quote_items')) {
        return Promise.resolve([{ insertId: 61 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT * FROM quote_items WHERE id')) {
        return Promise.resolve([[{ id: 61, inventory_item_id: 7 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/9/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1, unit_price: 500, amount: 500, inventory_item_id: 7 });

    expect(res.status).toBe(201);
    const insertCall = db.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO quote_items'));
    // req.params.id is a route-param string, not a number.
    expect(insertCall[1]).toEqual(['9', 'Router', 1, 500, null, 7]);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('returns 422 when inventory_item_id belongs to another organization', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM inventory_items WHERE id')) {
        return Promise.resolve([[]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/9/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1, unit_price: 500, amount: 500, inventory_item_id: 999 });

    expect(res.status).toBe(422);
  });

  it('returns 422 when quantity is fractional and inventory_item_id is set', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/9/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Router', quantity: 1.5, unit_price: 500, amount: 750, inventory_item_id: 7 });

    expect(res.status).toBe(422);
    // Fails before the org-ownership lookup even runs.
    expect(db.query.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('FROM inventory_items WHERE id'))).toBe(false);
  });

  it('allows a fractional quantity on a free-text (non-inventory) line item', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('INSERT INTO quote_items')) {
        return Promise.resolve([{ insertId: 62 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT * FROM quote_items WHERE id')) {
        return Promise.resolve([[{ id: 62, description: 'Labor (1.5 hrs)' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/9/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ description: 'Labor (1.5 hrs)', quantity: 1.5, unit_price: 100, amount: 150 });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/quotes/:id/convert-to-invoice — drawdown exactly once
// ---------------------------------------------------------------------------
describe('POST /api/v1/quotes/:id/convert-to-invoice — carries inventory_item_id + draws down once', () => {
  it('copies inventory_item_id to the new invoice_items row and draws down exactly once', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM quotes WHERE id')) {
        return Promise.resolve([[{
          id: 1, client_id: 5, contract_id: null, subtotal: '500.00', tax_amount: '80.00', total: '580.00',
          currency: 'MXN', tax_rate: '0.16', tax_rate_id: 1, notes: null, status: 'accepted',
        }]]);
      }
      if (typeof sql === 'string' && sql.includes('FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 50, total: '580.00' }]]);
      }
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ insertId: 50, affectedRows: 1 }]);
      if (sql.includes('SELECT * FROM quote_items WHERE quote_id')) {
        return Promise.resolve([[
          { id: 11, description: 'Router', quantity: 1, unit_price: 500, total: 500, tax_rate_id: null, inventory_item_id: 7 },
        ]]);
      }
      if (sql.includes('INSERT INTO invoice_items')) return Promise.resolve([{ insertId: 501, affectedRows: 1 }]);
      if (sql.includes('SELECT s.id FROM inventory_stock s')) return Promise.resolve([[{ id: 55 }]]);
      if (sql.includes('UPDATE inventory_stock SET quantity')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('INSERT INTO inventory_transactions')) return Promise.resolve([{ insertId: 900, affectedRows: 1 }]);
      if (sql.includes('UPDATE quotes SET status')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    });
    db.getConnection.mockResolvedValue(conn);

    // billingService is the real (non-mocked) module in this test file, and
    // nextInvoiceNumber runs a real INSERT IGNORE + UPDATE via conn.execute —
    // both fall through to the generic branch above, returning affectedRows
    // (not a specific number row), so stub the helper directly to avoid
    // fighting that SQL shape here.
    const billingService = require('../src/services/billingService');
    jest.spyOn(billingService, 'nextInvoiceNumber').mockResolvedValue('INV-000009');

    const res = await request(app)
      .post('/api/v1/quotes/1/convert-to-invoice')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(201);
    expect(conn.commit).toHaveBeenCalled();

    const itemInsertCall = conn.execute.mock.calls.find(c => c[0].includes('INSERT INTO invoice_items'));
    expect(itemInsertCall[1]).toEqual([50, 'Router', 1, 500, 500, null, 7]);

    const ledgerCalls = conn.execute.mock.calls.filter(c => c[0].includes('INSERT INTO inventory_transactions'));
    expect(ledgerCalls).toHaveLength(1);
    expect(ledgerCalls[0][1]).toEqual([55, 1, 500, 5, 50, 1, 'INV-000009']);

    const stockUpdateCalls = conn.execute.mock.calls.filter(c => c[0].includes('UPDATE inventory_stock SET quantity'));
    expect(stockUpdateCalls).toHaveLength(1);

    // The back-reference is stamped in the SAME transaction as the invoice
    // insert (migration 390) — this is what makes a retry detectable.
    const quoteUpdateCall = conn.execute.mock.calls.find(c => c[0].includes('UPDATE quotes SET status'));
    expect(quoteUpdateCall[1]).toEqual(['accepted', 50, '1']);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/quotes/:id/convert-to-invoice — idempotency (converted_invoice_id)
// ---------------------------------------------------------------------------
describe('POST /api/v1/quotes/:id/convert-to-invoice — idempotency', () => {
  it('returns 409 CONVERSION_EXISTS on a second convert and never opens a transaction (no double drawdown)', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM quotes WHERE id')) {
        return Promise.resolve([[{
          id: 1, client_id: 5, contract_id: null, subtotal: '500.00', tax_amount: '80.00', total: '580.00',
          currency: 'MXN', tax_rate: '0.16', tax_rate_id: 1, notes: null, status: 'accepted',
          converted_invoice_id: 50,
        }]]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT id, invoice_number FROM invoices WHERE id')) {
        return Promise.resolve([[{ id: 50, invoice_number: 'INV-000009' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/1/convert-to-invoice')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERSION_EXISTS');
    expect(res.body.error.message).toMatch(/INV-000009/);
    expect(res.body.error.message).toMatch(/50/);

    // No transaction opened at all — so no second invoice INSERT, no second
    // drawdownForSale call, no second inventory_transactions ledger row.
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('reports the existing invoice id even if that invoice row cannot be re-fetched', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM quotes WHERE id')) {
        return Promise.resolve([[{
          id: 1, client_id: 5, status: 'accepted', converted_invoice_id: 999,
        }]]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT id, invoice_number FROM invoices WHERE id')) {
        return Promise.resolve([[]]); // invoice since deleted/not found
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/quotes/1/convert-to-invoice')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERSION_EXISTS');
    expect(res.body.error.message).toMatch(/999/);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  // The early converted_invoice_id guard is check-then-act: two NEAR-CONCURRENT
  // converts can both read NULL and both proceed. The conditional stamp
  // (WHERE converted_invoice_id IS NULL) is what serializes them — the loser
  // matches 0 rows and must roll back its invoice + drawdown, not commit.
  it('rolls back and 409s when a concurrent conversion wins the atomic stamp (affectedRows 0)', async () => {
    db.query.mockImplementation((sql) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('FROM quotes WHERE id')) {
        return Promise.resolve([[{
          id: 1, client_id: 5, contract_id: null, subtotal: '500.00', tax_amount: '80.00', total: '580.00',
          currency: 'MXN', tax_rate: '0.16', tax_rate_id: 1, notes: null, status: 'accepted',
          converted_invoice_id: null, // guard passes — the race hasn't been lost yet
        }]]);
      }
      return Promise.resolve([[]]);
    });

    const conn = buildConn();
    conn.execute.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ insertId: 51, affectedRows: 1 }]);
      if (sql.includes('SELECT * FROM quote_items WHERE quote_id')) {
        return Promise.resolve([[
          { id: 11, description: 'Router', quantity: 1, unit_price: 500, total: 500, tax_rate_id: null, inventory_item_id: 7 },
        ]]);
      }
      if (sql.includes('INSERT INTO invoice_items')) return Promise.resolve([{ insertId: 502, affectedRows: 1 }]);
      if (sql.includes('SELECT s.id FROM inventory_stock s')) return Promise.resolve([[{ id: 55 }]]);
      if (sql.includes('UPDATE inventory_stock SET quantity')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('INSERT INTO inventory_transactions')) return Promise.resolve([{ insertId: 901, affectedRows: 1 }]);
      // The concurrent winner already stamped converted_invoice_id, so the
      // IS NULL condition matches nothing.
      if (sql.includes('UPDATE quotes SET status')) return Promise.resolve([{ affectedRows: 0 }]);
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    });
    db.getConnection.mockResolvedValue(conn);

    const billingService = require('../src/services/billingService');
    jest.spyOn(billingService, 'nextInvoiceNumber').mockResolvedValue('INV-000010');

    const res = await request(app)
      .post('/api/v1/quotes/1/convert-to-invoice')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERSION_EXISTS');

    // The stamp must be conditional, and the loser must roll back everything
    // (its invoice INSERT, stock decrement, and ledger row) — never commit.
    const stampCall = conn.execute.mock.calls.find(c => c[0].includes('UPDATE quotes SET status'));
    expect(stampCall[0]).toMatch(/converted_invoice_id IS NULL/);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/inventory/transactions
// ---------------------------------------------------------------------------
describe('GET /api/v1/inventory/transactions', () => {
  it('org-scopes, paginates newest-first with defaults, and enriches rows', async () => {
    db.query.mockImplementation((sql, params) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) AS total')) {
        return Promise.resolve([[{ total: 2 }]]);
      }
      if (typeof sql === 'string' && sql.includes('FROM inventory_transactions t')) {
        expect(sql).toMatch(/i\.organization_id = \? OR i\.organization_id IS NULL/);
        expect(sql).toMatch(/ORDER BY t\.created_at DESC/);
        expect(sql).toMatch(/LIMIT 50 OFFSET 0/);
        expect(params[0]).toBe(10);
        return Promise.resolve([[
          { id: 900, stock_id: 55, transaction_type: 'sell_to_client', quantity: 2, item_name: 'Router', item_sku: 'RB-1', warehouse_name: 'Main' },
        ]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ item_name: 'Router', warehouse_name: 'Main' });
    expect(res.body.meta).toEqual({ total: 2, limit: 50, offset: 0 });
  });

  it('applies item_id/transaction_type filters and custom limit/offset', async () => {
    db.query.mockImplementation((sql, params) => {
      if (isUserLookup(sql)) return Promise.resolve([[ADMIN_USER_ROW]]);
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) AS total')) {
        expect(sql).toMatch(/s\.item_id = \?/);
        expect(sql).toMatch(/t\.transaction_type = \?/);
        return Promise.resolve([[{ total: 0 }]]);
      }
      if (typeof sql === 'string' && sql.includes('FROM inventory_transactions t')) {
        expect(sql).toMatch(/LIMIT 5 OFFSET 10/);
        // Query-string values arrive as strings — matches this file's other
        // filter routes (e.g. auditLogs.js), no Number() coercion.
        expect(params).toEqual([10, '7', 'sell_to_client']);
        return Promise.resolve([[]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/inventory/transactions?item_id=7&transaction_type=sell_to_client&limit=5&offset=10')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 0, limit: 5, offset: 10 });
  });
});
