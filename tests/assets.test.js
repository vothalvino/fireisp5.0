// =============================================================================
// FireISP 5.0 — Asset Route Tests (§14)
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

const sampleAsset = {
  id: 1,
  organization_id: 10,
  asset_tag: 'AST-001',
  barcode: 'AST-00000001',
  name: 'EdgeRouter X #1',
  category: 'router',
  manufacturer: 'Ubiquiti',
  model: 'ER-X',
  serial_number: 'SN123456',
  inventory_item_id: 1,
  warehouse_id: 1,
  vendor_id: 1,
  purchase_order_id: null,
  lifecycle_status: 'in_stock',
  purchase_date: '2024-01-01',
  purchase_cost: '99.00',
  warranty_expires_at: '2027-01-01',
  warranty_notes: null,
  depreciation_method: 'straight_line',
  useful_life_months: 60,
  salvage_value: '10.00',
  disposed_at: null,
  disposal_reason: null,
  disposal_notes: null,
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup — SELECT from users (WHERE id = ?, not asset tables)
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') &&
        !sql.includes('assets') && !sql.includes('asset_assignments')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'assets.view' }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // asset_assignments queries
    if (typeof sql === 'string' && sql.includes('asset_assignments')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 1, asset_id: 1, organization_id: 10, client_id: 1, assigned_at: '2026-01-01T00:00:00.000Z', returned_at: null }]]);
    }
    // rma_requests queries
    if (typeof sql === 'string' && sql.includes('rma_requests')) {
      return Promise.resolve([[]]);
    }
    // inventory_items queries (getLowStockItems uses JOIN to inventory_items)
    if (typeof sql === 'string' && sql.includes('inventory_items')) {
      return Promise.resolve([[]]);
    }
    // inventory_stock queries
    if (typeof sql === 'string' && sql.includes('inventory_stock')) {
      return Promise.resolve([[]]);
    }
    // assets table queries
    if (typeof sql === 'string' && sql.includes('assets')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('DELETE')) return Promise.resolve([{ affectedRows: 1 }]);
      // getStats query — COUNT(*) + SUM(...)
      if (sql.includes('COUNT(*)') || sql.includes('SUM(')) {
        return Promise.resolve([[{ total: 5, in_stock: 3, assigned: 1, deployed: 1, maintenance: 0, rma: 0, disposed: 0, warranty_expired: 0, warranty_expiring_soon: 0 }]]);
      }
      return Promise.resolve([[sampleAsset]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('GET /api/v1/assets', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with asset list', async () => {
    const res = await request(app)
      .get('/api/v1/assets')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/assets/stats', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with aggregate stats', async () => {
    const res = await request(app)
      .get('/api/v1/assets/stats')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('in_stock');
  });
});

describe('GET /api/v1/assets/low-stock', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with low-stock items', async () => {
    const res = await request(app)
      .get('/api/v1/assets/low-stock')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/assets/scan', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 when barcode matches an asset', async () => {
    const res = await request(app)
      .post('/api/v1/assets/scan')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ barcode: 'AST-00000001' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('barcode', 'AST-00000001');
  });

  it('returns 404 when no asset matches barcode', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('assets')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'assets.scan' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      // Return empty for all asset queries — triggers 404 in findByBarcode
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/assets/scan')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ barcode: 'NONEXISTENT' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/assets/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with asset details', async () => {
    const res = await request(app)
      .get('/api/v1/assets/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('serial_number', 'SN123456');
  });
});

describe('POST /api/v1/assets', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates an asset and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'EdgeRouter X #2', category: 'router', serial_number: 'SN654321' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ category: 'router' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/assets/:id/barcode', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with barcode data', async () => {
    const res = await request(app)
      .get('/api/v1/assets/1/barcode')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('barcode_payload');
    expect(res.body.data).toHaveProperty('format', 'code128');
  });
});

describe('GET /api/v1/assets/:id/depreciation', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with depreciation data', async () => {
    const res = await request(app)
      .get('/api/v1/assets/1/depreciation')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('method');
    expect(res.body.data).toHaveProperty('book_value');
  });
});

describe('POST /api/v1/assets/:id/assign', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('assigns asset to client and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/assets/1/assign')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 5, notes: 'Assigned to client' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/assets/:id/dispose', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('disposes asset and returns 200', async () => {
    const res = await request(app)
      .post('/api/v1/assets/1/dispose')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ disposal_reason: 'damaged', disposal_notes: 'Water damage' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when disposal_reason is missing', async () => {
    const res = await request(app)
      .post('/api/v1/assets/1/dispose')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/assets/:id/assignments', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with assignment history', async () => {
    const res = await request(app)
      .get('/api/v1/assets/1/assignments')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});
