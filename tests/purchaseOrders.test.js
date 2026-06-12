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
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('marks PO as received and returns 200', async () => {
    // Mock the PO as 'sent' so it can be received
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
      if (typeof sql === 'string' && sql.includes('purchase_order_items')) {
        if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
        // Return items without inventory_item_id so stock update is skipped
        return Promise.resolve([[{ ...samplePoItem, inventory_item_id: null }]]);
      }
      if (typeof sql === 'string' && sql.includes('purchase_orders')) {
        if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
        if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: 1 }]]);
        // Return PO as 'sent' status so it can be received
        return Promise.resolve([[{ ...samplePo, status: 'sent', warehouse_id: null }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/purchase-orders/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(200);
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
