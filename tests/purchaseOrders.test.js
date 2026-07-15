// =============================================================================
// FireISP 5.0 — Purchase Order Route Tests (§14)
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

const samplePo = {
  id: 1,
  organization_id: 10,
  vendor_id: 1,
  po_number: 'PO-2026-001',
  status: 'draft',
  order_date: '2026-01-01',
  expected_date: '2026-01-15',
  received_date: null,
  warehouse_id: 1,
  subtotal: '1000.00',
  tax_amount: '160.00',
  total: '1160.00',
  currency: 'USD',
  reference: null,
  notes: null,
  created_by: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

const samplePoItem = {
  id: 1,
  po_id: 1,
  inventory_item_id: 1,
  description: 'Ubiquiti EdgeRouter X',
  quantity_ordered: 10,
  quantity_received: 0,
  unit_cost: '100.0000',
  total_cost: '1000.0000',
  notes: null,
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') &&
        !sql.includes('purchase_orders') && !sql.includes('purchase_order_items')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'purchase_orders.view' }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // purchase_order_items queries
    if (typeof sql === 'string' && sql.includes('purchase_order_items')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('DELETE')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[samplePoItem]]);
    }
    // purchase_orders queries
    if (typeof sql === 'string' && sql.includes('purchase_orders')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('DELETE')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: 1 }]]);
      return Promise.resolve([[samplePo]]);
    }
    // inventory_stock queries
    if (typeof sql === 'string' && sql.includes('inventory_stock')) {
      return Promise.resolve([[]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('GET /api/v1/purchase-orders', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with PO list', async () => {
    const res = await request(app)
      .get('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/purchase-orders', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates a PO and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ po_number: 'PO-2026-001', vendor_id: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when po_number is missing', async () => {
    const res = await request(app)
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ vendor_id: 1 });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/purchase-orders/:id/items', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with line items', async () => {
    const res = await request(app)
      .get('/api/v1/purchase-orders/1/items')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/purchase-orders/:id/receive', () => {
  // The receive handler now runs inside a db.getConnection() transaction, so
  // every test in this block needs a `conn` double (beginTransaction/query/
  // commit/rollback/release), not just db.query. mockAuthQuery covers the
  // reads made OUTSIDE the transaction (auth, RBAC, PurchaseOrder.findById
  // before AND after the transaction); connQuery covers every statement
  // issued through `conn` once the transaction opens.
  function mockAuthQuery(poOverrides = {}) {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') &&
          !sql.includes('purchase_orders') && !sql.includes('purchase_order_items')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'purchase_orders.receive' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('purchase_orders') && sql.includes('COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('purchase_orders')) {
        // PurchaseOrder.findById — called both before opening the transaction
        // (status guard) and after commit (response payload).
        return Promise.resolve([[{ ...samplePo, status: 'sent', warehouse_id: 5, ...poOverrides }]]);
      }
      return Promise.resolve([[]]);
    });
  }

  function buildConn(lineItems, { serialRequiredByItemId = {}, existingSerials = [] } = {}) {
    const stockRows = new Map(); // item_id:warehouse_id -> { id, quantity }
    let nextStockId = 100;
    let nextDeviceId = 900;
    const createdDevices = [];
    const takenSerials = new Set(existingSerials);
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
      _createdDevices: createdDevices,
      query: jest.fn((sql, params) => {
        if (typeof sql !== 'string') return Promise.resolve([[]]);
        if (sql.includes('SELECT * FROM purchase_order_items WHERE po_id')) {
          return Promise.resolve([lineItems]);
        }
        // Inventory Phase 3 (migration 391): serial_required lookup per item.
        if (sql.includes('SELECT serial_required FROM inventory_items WHERE id')) {
          const itemId = params[0];
          const required = !!serialRequiredByItemId[itemId];
          return Promise.resolve([[{ serial_required: required ? 1 : 0 }]]);
        }
        // Inventory Phase 3: duplicate-serial guard (_assertSerialNotTaken).
        if (sql.includes('SELECT id FROM cpe_devices WHERE serial_number')) {
          const serial = params[0];
          return Promise.resolve([takenSerials.has(serial) ? [{ id: 1 }] : []]);
        }
        // Inventory Phase 3: per-serial unit creation (createTrackedUnits).
        if (sql.includes('INSERT INTO cpe_devices')) {
          const id = nextDeviceId++;
          createdDevices.push({ id, serial_number: params[1], inventory_item_id: params[2] });
          takenSerials.add(params[1]);
          return Promise.resolve([{ insertId: id }]);
        }
        if (sql.includes('SELECT id FROM inventory_stock WHERE item_id')) {
          // key doesn't matter for these tests — single item/warehouse combo
          const existing = [...stockRows.values()][0];
          return Promise.resolve([existing ? [{ id: existing.id }] : []]);
        }
        if (sql.includes('INSERT INTO inventory_stock')) {
          const id = nextStockId++;
          stockRows.set('k', { id });
          return Promise.resolve([{ insertId: id }]);
        }
        if (sql.includes('UPDATE inventory_stock SET quantity')) {
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        if (sql.includes('INSERT INTO inventory_transactions')) {
          return Promise.resolve([{ insertId: 500 }]);
        }
        if (sql.includes('UPDATE purchase_order_items SET quantity_received')) {
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        if (sql.includes('UPDATE purchase_orders SET status')) {
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        return Promise.resolve([[]]);
      }),
    };
    return conn;
  }

  afterEach(() => { jest.clearAllMocks(); });

  it('marks PO as received and returns 200 (full receive, no body)', async () => {
    mockAuthQuery();
    const conn = buildConn([{ ...samplePoItem, inventory_item_id: null }]);
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('writes an inventory_transactions ledger row and creates stock for a line with an inventory_item_id', async () => {
    mockAuthQuery();
    const conn = buildConn([{ ...samplePoItem, inventory_item_id: 1, quantity_ordered: 10, quantity_received: 0, unit_cost: '100.0000' }]);
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});

    expect(res.status).toBe(200);
    const calls = conn.query.mock.calls.map(c => c[0]);
    expect(calls.some(sql => sql.includes('INSERT INTO inventory_stock'))).toBe(true);
    expect(calls.some(sql => sql.includes('INSERT INTO inventory_transactions'))).toBe(true);
    // The ledger insert carries the PO number as its reference and the
    // received quantity (10, full receive) as its quantity.
    const ledgerCall = conn.query.mock.calls.find(c => c[0].includes('INSERT INTO inventory_transactions'));
    expect(ledgerCall[1]).toEqual(expect.arrayContaining([10, samplePo.po_number]));
  });

  it('rolls back the transaction when a query inside it fails', async () => {
    mockAuthQuery();
    const conn = buildConn([{ ...samplePoItem, inventory_item_id: 1, quantity_ordered: 10, quantity_received: 0 }]);
    conn.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT * FROM purchase_order_items WHERE po_id')) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});

    expect(res.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('supports a partial receive via items[] and sets status to partial', async () => {
    mockAuthQuery();
    const conn = buildConn([{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 10, quantity_received: 0 }]);
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ items: [{ id: 1, quantity_received: 4 }] });

    expect(res.status).toBe(200);
    const statusCall = conn.query.mock.calls.find(c => c[0].includes('UPDATE purchase_orders SET status'));
    expect(statusCall[1][0]).toBe('partial');
    const receivedQtyCall = conn.query.mock.calls.find(c => c[0].includes('UPDATE purchase_order_items SET quantity_received'));
    expect(receivedQtyCall[1][0]).toBe(4);
  });

  it('marks status received when every line is fully received via items[]', async () => {
    mockAuthQuery();
    const conn = buildConn([{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 10, quantity_received: 0 }]);
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ items: [{ id: 1, quantity_received: 10 }] });

    expect(res.status).toBe(200);
    const statusCall = conn.query.mock.calls.find(c => c[0].includes('UPDATE purchase_orders SET status'));
    expect(statusCall[1][0]).toBe('received');
  });

  it('rejects a malformed items[] entry with 422', async () => {
    mockAuthQuery();
    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ items: [{ id: 'not-a-number', quantity_received: 4 }] });
    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('returns 400 when the PO is already fully received', async () => {
    mockAuthQuery({ status: 'received' });
    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALREADY_RECEIVED');
  });

  // ---------------------------------------------------------------------
  // Inventory Phase 3 (migration 391) — serial-tracked receive
  // ---------------------------------------------------------------------

  it('422s and writes nothing when a serial_required line is missing serials', async () => {
    mockAuthQuery();
    const conn = buildConn(
      [{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 3, quantity_received: 0 }],
      { serialRequiredByItemId: { 1: true } },
    );
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({}); // no serials at all — delta is 3, needs exactly 3

    expect(res.status).toBe(422);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    // No stock/PO-item writes happened before the validation threw.
    const calls = conn.query.mock.calls.map(c => c[0]);
    expect(calls.some(sql => sql.includes('UPDATE inventory_stock'))).toBe(false);
    expect(calls.some(sql => sql.includes('UPDATE purchase_order_items SET quantity_received'))).toBe(false);
    expect(conn._createdDevices.length).toBe(0);
  });

  it('422s when the serials count does not match the delta (wrong count, not just missing)', async () => {
    mockAuthQuery();
    const conn = buildConn(
      [{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 3, quantity_received: 0 }],
      { serialRequiredByItemId: { 1: true } },
    );
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ serials: { 1: ['SN-A', 'SN-B'] } }); // 2 serials for a delta of 3

    expect(res.status).toBe(422);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn._createdDevices.length).toBe(0);
  });

  it('creates one cpe_devices row per serial, atomically with the stock increment and ledger row', async () => {
    mockAuthQuery();
    const conn = buildConn(
      [{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 2, quantity_received: 0, unit_cost: '50.0000' }],
      { serialRequiredByItemId: { 1: true } },
    );
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ serials: { 1: ['SN-100', 'SN-101'] } });

    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn._createdDevices.map(d => d.serial_number)).toEqual(['SN-100', 'SN-101']);
    expect(conn._createdDevices.every(d => d.inventory_item_id === 1)).toBe(true);
    const calls = conn.query.mock.calls.map(c => c[0]);
    // No pre-existing stock row for this item/warehouse in this test, so the
    // route's existing Phase 1 upsert takes the INSERT branch, not UPDATE.
    expect(calls.some(sql => sql.includes('INSERT INTO inventory_stock'))).toBe(true);
    expect(calls.some(sql => sql.includes('INSERT INTO inventory_transactions'))).toBe(true);
  });

  it('does not require serials for a non-serial_required line even with an inventory_item_id', async () => {
    mockAuthQuery();
    const conn = buildConn(
      [{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 5, quantity_received: 0 }],
      { serialRequiredByItemId: { 1: false } },
    );
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({}); // no serials — fine, item is not serial_required

    expect(res.status).toBe(200);
    expect(conn._createdDevices.length).toBe(0);
  });

  it('422s BEFORE any write when a serial_required line is received on a warehouse-less PO', async () => {
    mockAuthQuery({ warehouse_id: null });
    const conn = buildConn(
      [{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 3, quantity_received: 0 }],
      { serialRequiredByItemId: { 1: true } },
    );
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ serials: { 1: ['SN-A', 'SN-B', 'SN-C'] } }); // correct count, but no warehouse on the PO

    expect(res.status).toBe(422);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn._createdDevices.length).toBe(0);
    const calls = conn.query.mock.calls.map(c => c[0]);
    expect(calls.some(sql => sql.includes('UPDATE inventory_stock'))).toBe(false);
    expect(calls.some(sql => sql.includes('UPDATE purchase_order_items SET quantity_received'))).toBe(false);
  });

  it('still succeeds receiving a warehouse-less PO when every line is non-serialized', async () => {
    mockAuthQuery({ warehouse_id: null });
    const conn = buildConn(
      [{ ...samplePoItem, id: 1, inventory_item_id: 1, quantity_ordered: 5, quantity_received: 0 }],
      { serialRequiredByItemId: { 1: false } },
    );
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});

    // Pre-existing behavior for warehouse-less POs (no warehouse_id means no
    // inventory_stock/ledger side effect for ANY line, serialized or not) is
    // unchanged for non-serialized lines — only serial_required lines with a
    // positive delta are newly rejected.
    expect(res.status).toBe(200);
    expect(conn._createdDevices.length).toBe(0);
  });
});

describe('PUT /api/v1/purchase-orders/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('updates a PO and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/purchase-orders/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ status: 'sent', notes: 'Sent to vendor' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/v1/purchase-orders/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('soft-deletes a PO and returns 204', async () => {
    const res = await request(app)
      .delete('/api/v1/purchase-orders/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(204);
  });
});
