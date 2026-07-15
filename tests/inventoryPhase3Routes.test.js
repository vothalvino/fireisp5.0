// =============================================================================
// FireISP 5.0 — Inventory Phase 3 route-wiring tests (migration 391)
// =============================================================================
// Route-level coverage for the two new cpe-management endpoints (manual
// serial registration, install) and the two new work-orders pickup-checklist
// endpoints. Business logic itself (stock/ledger math, org-scoping, the FSM)
// is covered exhaustively at the service layer in
// tests/inventorySerialService.test.js — these tests only prove the routes
// are wired correctly: validate() schemas, requirePermission gates, status
// codes, and response shape. role: 'admin' bypasses RBAC entirely (see
// src/middleware/rbac.js), so no permissions/role_permissions mock is needed.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}
const TOKEN = adminToken();

const ADMIN_ROW = [[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 42 }]];
const isAuthLookup = (s) => typeof s === 'string' && /WHERE id = \?/.test(s) && !/cpe_devices/.test(s) && !/inventory_items/.test(s) && !/work_orders/.test(s) && !/contracts/.test(s);

beforeEach(() => { jest.clearAllMocks(); });

function buildConn(dispatch) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(dispatch),
    query: jest.fn(dispatch),
  };
}

// ---------------------------------------------------------------------------
// POST /cpe-management/devices/register
// ---------------------------------------------------------------------------
describe('POST /api/v1/cpe-management/devices/register', () => {
  test('registers a serial (catch-up, no stock change) and returns 201', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      return Promise.resolve([[{ id: 900, serial_number: 'LEGACY-1', lifecycle_state: 'in_stock' }]]);
    });
    const conn = buildConn((sql) => {
      if (sql.includes('SELECT * FROM inventory_items WHERE id')) {
        return Promise.resolve([[{ id: 1, organization_id: 42, name: 'ONU-X' }]]);
      }
      if (sql.includes('SELECT id FROM cpe_devices WHERE serial_number')) return Promise.resolve([[]]);
      // _untrackedCapacity (catch-up capacity guard): 5 units of physical
      // stock, 0 already tracked in_stock -> capacity 5, guard passes.
      if (sql.includes('COALESCE(SUM(s.quantity), 0) AS total')) return Promise.resolve([[{ total: 5 }]]);
      if (sql.includes('COUNT(*) AS total FROM cpe_devices') && sql.includes("lifecycle_state = 'in_stock'")) {
        return Promise.resolve([[{ total: 0 }]]);
      }
      if (sql.includes('INSERT INTO cpe_devices')) return Promise.resolve([{ insertId: 900 }]);
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/cpe-management/devices/register')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ inventory_item_id: 1, serial_number: 'LEGACY-1' });

    expect(res.status).toBe(201);
    expect(res.body.data.serial_number).toBe('LEGACY-1');
    expect(conn.commit).toHaveBeenCalled();
  });

  test('422s when serial_number is missing (validate() schema gate)', async () => {
    db.query.mockImplementation((sql) => (isAuthLookup(sql) ? Promise.resolve(ADMIN_ROW) : Promise.resolve([[]])));

    const res = await request(app)
      .post('/api/v1/cpe-management/devices/register')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ inventory_item_id: 1 });

    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /cpe-management/devices/install
// ---------------------------------------------------------------------------
describe('POST /api/v1/cpe-management/devices/install', () => {
  test('installs an existing in-stock serial as rented and returns 201', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      // installEquipment's post-commit re-select goes through db.query (not conn).
      if (sql === 'SELECT * FROM cpe_devices WHERE id = ?') {
        return Promise.resolve([[{ id: 50, lifecycle_state: 'assigned', ownership: 'rented', contract_id: 900 }]]);
      }
      return Promise.resolve([[]]);
    });
    const conn = buildConn((sql) => {
      if (sql.includes('SELECT id, client_id, organization_id FROM contracts')) {
        return Promise.resolve([[{ id: 900, client_id: 100, organization_id: 42 }]]);
      }
      if (sql.includes('FOR UPDATE') && sql.includes('cpe_devices')) {
        return Promise.resolve([[{ id: 50, organization_id: 42, serial_number: 'SN-1', inventory_item_id: 1, lifecycle_state: 'in_stock' }]]);
      }
      if (sql.includes('UPDATE cpe_devices SET contract_id')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('SELECT id, lifecycle_state, organization_id FROM cpe_devices')) {
        return Promise.resolve([[{ id: 50, lifecycle_state: 'in_stock', organization_id: 42 }]]);
      }
      if (sql.includes('UPDATE cpe_devices SET lifecycle_state')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('INSERT INTO cpe_lifecycle_history')) return Promise.resolve([{ insertId: 1 }]);
      if (sql === 'SELECT * FROM cpe_devices WHERE id = ?') {
        return Promise.resolve([[{ id: 50, lifecycle_state: 'assigned', ownership: 'rented', contract_id: 900 }]]);
      }
      if (sql.includes('SELECT s.id FROM inventory_stock')) return Promise.resolve([[{ id: 10 }]]);
      if (sql.includes('UPDATE inventory_stock')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('INSERT INTO inventory_transactions')) return Promise.resolve([{ insertId: 1 }]);
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/cpe-management/devices/install')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ contract_id: 900, cpe_device_id: 50, ownership: 'rented' });

    expect(res.status).toBe(201);
    expect(res.body.data.unit.ownership).toBe('rented');
    expect(res.body.data.invoice).toBeNull();
    expect(conn.commit).toHaveBeenCalled();
  });

  test('422s when ownership is missing (validate() schema gate)', async () => {
    db.query.mockImplementation((sql) => (isAuthLookup(sql) ? Promise.resolve(ADMIN_ROW) : Promise.resolve([[]])));

    const res = await request(app)
      .post('/api/v1/cpe-management/devices/install')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ contract_id: 900, cpe_device_id: 50 });

    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('422s when ownership is not rented/sold (enum gate)', async () => {
    db.query.mockImplementation((sql) => (isAuthLookup(sql) ? Promise.resolve(ADMIN_ROW) : Promise.resolve([[]])));

    const res = await request(app)
      .post('/api/v1/cpe-management/devices/install')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ contract_id: 900, cpe_device_id: 50, ownership: 'leased' });

    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET/POST /work-orders/:id/pickup-items
// ---------------------------------------------------------------------------
describe('GET /api/v1/work-orders/:id/pickup-items', () => {
  test('returns the outstanding rented-equipment checklist', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (sql.includes("work_type = 'pickup'")) {
        return Promise.resolve([[{ id: 700, organization_id: 42, contract_id: 900, work_type: 'pickup', status: 'pending' }]]);
      }
      if (sql.includes('FROM cpe_devices d')) {
        return Promise.resolve([[{ id: 50, serial_number: 'SN-1', item_name: 'ONU-X' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/work-orders/700/pickup-items')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.contract_id).toBe(900);
  });

  test('404s for a work order that is not a pickup order', async () => {
    db.query.mockImplementation((sql) => (isAuthLookup(sql) ? Promise.resolve(ADMIN_ROW) : Promise.resolve([[]])));

    const res = await request(app)
      .get('/api/v1/work-orders/999/pickup-items')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/work-orders/:id/pickup-items', () => {
  test('resolves a unit as returned: 200 with the updated device', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (sql.includes("work_type = 'pickup'")) {
        return Promise.resolve([[{ id: 700, organization_id: 42, contract_id: 900, client_id: 100, work_type: 'pickup', status: 'pending' }]]);
      }
      if (sql.includes('SELECT COUNT(*) AS cnt FROM cpe_devices')) return Promise.resolve([[{ cnt: 0 }]]);
      if (sql.startsWith("UPDATE work_orders SET status = 'completed'")) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql === 'SELECT * FROM cpe_devices WHERE id = ?') {
        return Promise.resolve([[{ id: 50, lifecycle_state: 'in_stock', ownership: null }]]);
      }
      return Promise.resolve([[]]);
    });
    const conn = buildConn((sql) => {
      if (sql.includes('FOR UPDATE') && sql.includes('cpe_devices')) {
        return Promise.resolve([[{ id: 50, organization_id: 42, contract_id: 900, ownership: 'rented', lifecycle_state: 'assigned', inventory_item_id: 1, serial_number: 'SN-1' }]]);
      }
      if (sql.includes('SELECT id, lifecycle_state, organization_id FROM cpe_devices')) {
        return Promise.resolve([[{ id: 50, lifecycle_state: 'assigned', organization_id: 42 }]]);
      }
      if (sql.includes('UPDATE cpe_devices SET lifecycle_state')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('INSERT INTO cpe_lifecycle_history')) return Promise.resolve([{ insertId: 1 }]);
      if (sql === 'SELECT * FROM cpe_devices WHERE id = ?') {
        return Promise.resolve([[{ id: 50, lifecycle_state: 'in_stock' }]]);
      }
      if (sql.includes('UPDATE cpe_devices SET contract_id = NULL')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('SELECT s.id FROM inventory_stock')) return Promise.resolve([[{ id: 10 }]]);
      if (sql.includes('UPDATE inventory_stock')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('INSERT INTO inventory_transactions')) return Promise.resolve([{ insertId: 1 }]);
      return Promise.resolve([[]]);
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/work-orders/700/pickup-items')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ cpe_device_id: 50, disposition: 'returned' });

    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalled();
  });

  test('422s when disposition is not returned/rma (enum gate)', async () => {
    db.query.mockImplementation((sql) => (isAuthLookup(sql) ? Promise.resolve(ADMIN_ROW) : Promise.resolve([[]])));

    const res = await request(app)
      .post('/api/v1/work-orders/700/pickup-items')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ cpe_device_id: 50, disposition: 'lost' });

    expect(res.status).toBe(422);
    expect(db.getConnection).not.toHaveBeenCalled();
  });
});
