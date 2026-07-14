// =============================================================================
// FireISP 5.0 — Inventory Transaction Route Tests (§14 — Inventory Phase 1)
// =============================================================================
// Covers POST /api/v1/inventory/transactions: the generic stock-movement
// ledger endpoint. Phase 1 added the ability to create a brand-new
// inventory_stock row on the fly (via item_id + warehouse_id) for
// transaction_type 'receive'/'adjustment' — previously the only way to ever
// create a stock row was a Purchase Order receive. The whole handler now also
// runs inside a DB transaction and org-scopes stock_id/item_id/warehouse_id.
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

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function mockAuthQuery() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('inventory_transactions')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'inventory.create' }]]);
    }
    if (typeof sql === 'string' && sql.includes('SELECT * FROM inventory_transactions WHERE id')) {
      return Promise.resolve([[{ id: 900, stock_id: 55, transaction_type: 'receive', quantity: 5 }]]);
    }
    return Promise.resolve([[]]);
  });
}

// Builds a conn double whose .query dispatches on statement shape. `opts`
// lets each test control whether a stock row / item / warehouse "exists".
function buildConn(opts = {}) {
  const {
    stockExists = false,
    itemExists = true,
    warehouseExists = true,
    stockOrgMatch = true,
  } = opts;
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn((sql) => {
      if (typeof sql !== 'string') return Promise.resolve([[]]);
      if (sql.includes('SELECT id FROM inventory_items WHERE id')) {
        return Promise.resolve([itemExists ? [{ id: 1 }] : []]);
      }
      if (sql.includes('SELECT id FROM warehouses WHERE id')) {
        return Promise.resolve([warehouseExists ? [{ id: 5 }] : []]);
      }
      if (sql.includes('SELECT id FROM inventory_stock WHERE item_id')) {
        return Promise.resolve([stockExists ? [{ id: 55 }] : []]);
      }
      if (sql.includes('INSERT INTO inventory_stock')) {
        return Promise.resolve([{ insertId: 55 }]);
      }
      if (sql.includes('SELECT s.id FROM inventory_stock s')) {
        return Promise.resolve([stockOrgMatch ? [{ id: 55 }] : []]);
      }
      if (sql.includes('INSERT INTO inventory_transactions')) {
        return Promise.resolve([{ insertId: 900 }]);
      }
      if (sql.includes('UPDATE inventory_stock SET quantity')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    }),
  };
  return conn;
}

describe('POST /api/v1/inventory/transactions', () => {
  beforeEach(() => { mockAuthQuery(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('records a transaction against an existing stock_id (existing behavior)', async () => {
    const conn = buildConn({ stockOrgMatch: true });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ stock_id: 55, transaction_type: 'adjustment', quantity: 3, reference: 'ADJ-1' });

    expect(res.status).toBe(201);
    expect(conn.commit).toHaveBeenCalled();
    const ledgerCall = conn.query.mock.calls.find(c => c[0].includes('INSERT INTO inventory_transactions'));
    // stock_id, transaction_type, quantity, unit_price, job_id, client_id, invoice_id, performed_by, reference, notes
    expect(ledgerCall[1]).toEqual([55, 'adjustment', 3, null, null, null, null, 1, 'ADJ-1', null]);
  });

  it('returns 404 when stock_id does not resolve to a row in this org', async () => {
    const conn = buildConn({ stockOrgMatch: false });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ stock_id: 999, transaction_type: 'adjustment', quantity: 3 });

    expect(res.status).toBe(404);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('returns 422 when neither stock_id nor item_id+warehouse_id are provided', async () => {
    const conn = buildConn();
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ transaction_type: 'receive', quantity: 5 });

    expect(res.status).toBe(422);
  });

  it('creates a new inventory_stock row for a first-time receive via item_id + warehouse_id', async () => {
    const conn = buildConn({ stockExists: false, itemExists: true, warehouseExists: true });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ item_id: 1, warehouse_id: 5, transaction_type: 'receive', quantity: 20, unit_price: 150 });

    expect(res.status).toBe(201);
    const calls = conn.query.mock.calls.map(c => c[0]);
    expect(calls.some(sql => sql.includes('INSERT INTO inventory_stock'))).toBe(true);
    const ledgerCall = conn.query.mock.calls.find(c => c[0].includes('INSERT INTO inventory_transactions'));
    expect(ledgerCall[1][0]).toBe(55); // the newly-created stock id
    expect(conn.commit).toHaveBeenCalled();
  });

  it('reuses an existing stock row for item_id + warehouse_id instead of creating a duplicate', async () => {
    const conn = buildConn({ stockExists: true });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ item_id: 1, warehouse_id: 5, transaction_type: 'receive', quantity: 5 });

    expect(res.status).toBe(201);
    const calls = conn.query.mock.calls.map(c => c[0]);
    expect(calls.some(sql => sql.includes('INSERT INTO inventory_stock'))).toBe(false);
  });

  it('returns 422 for a non-receive/adjustment type with no existing stock (cannot sell/assign from nothing)', async () => {
    const conn = buildConn({ stockExists: false });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ item_id: 1, warehouse_id: 5, transaction_type: 'sell_to_client', quantity: 2 });

    expect(res.status).toBe(422);
    const calls = conn.query.mock.calls.map(c => c[0]);
    expect(calls.some(sql => sql.includes('INSERT INTO inventory_stock'))).toBe(false);
  });

  it('returns 404 when item_id does not belong to this org', async () => {
    const conn = buildConn({ itemExists: false });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ item_id: 999, warehouse_id: 5, transaction_type: 'receive', quantity: 5 });

    expect(res.status).toBe(404);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('rolls back the transaction on a mid-flight failure', async () => {
    const conn = buildConn();
    conn.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT s.id FROM inventory_stock s')) {
        return Promise.reject(new Error('db exploded'));
      }
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ stock_id: 55, transaction_type: 'adjustment', quantity: 1 });

    expect(res.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
