// =============================================================================
// FireISP 5.0 — Vendor Route Tests (§14)
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

const sampleVendor = {
  id: 1,
  organization_id: 10,
  name: 'Ubiquiti Networks',
  contact_name: 'Sales',
  email: 'sales@ubnt.com',
  phone: '+1-800-000-0000',
  website: 'https://ui.com',
  address: 'San Jose, CA',
  tax_id: null,
  payment_terms: 'Net 30',
  currency: 'USD',
  notes: null,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup — SELECT from users table (WHERE id = ?, no vendor table name)
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('vendors')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'vendors.view' }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // vendors table queries
    if (typeof sql === 'string' && sql.includes('vendors')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('DELETE')) return Promise.resolve([{ affectedRows: 1 }]);
      // count() query — returns a total field
      if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: 1 }]]);
      // SELECT queries — return sample row
      return Promise.resolve([[sampleVendor]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('GET /api/v1/vendors', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with vendor list', async () => {
    const res = await request(app)
      .get('/api/v1/vendors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/vendors/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with a single vendor', async () => {
    const res = await request(app)
      .get('/api/v1/vendors/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name', 'Ubiquiti Networks');
  });

  it('returns 404 when vendor not found', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('vendors')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'vendors.view' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      // Return empty for all vendor queries — triggers 404
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .get('/api/v1/vendors/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/vendors', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates a vendor and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'MikroTik', currency: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ currency: 'USD' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/v1/vendors/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('updates a vendor and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/vendors/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Ubiquiti Updated', status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('DELETE /api/v1/vendors/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('soft-deletes a vendor and returns 204', async () => {
    const res = await request(app)
      .delete('/api/v1/vendors/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(204);
  });
});
