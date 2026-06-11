// =============================================================================
// FireISP 5.0 — PTR Record Route Tests (§5 Dual Stack)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const sampleRecord = {
  id: 1,
  organization_id: 10,
  ip_address: '192.168.1.1',
  ip_version: 'ipv4',
  hostname: 'host1.example.com',
  ttl: 3600,
  zone: 'in-addr.arpa',
  status: 'active',
  notes: null,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ptr_records')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'ptr_records.view' }]]);
    }
    // Count query
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // INSERT for ptr_records
    if (typeof sql === 'string' && sql.includes('INSERT INTO ptr_records')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // UPDATE for ptr_records
    if (typeof sql === 'string' && sql.includes('UPDATE ptr_records')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Soft delete
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default: return sample row
    return Promise.resolve([[sampleRecord]]);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PTR Record routes', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/ptr-records returns list', async () => {
    const res = await request(app)
      .get('/api/v1/ptr-records')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/ptr-records/:id returns single record', async () => {
    const res = await request(app)
      .get('/api/v1/ptr-records/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/ptr-records creates record', async () => {
    const res = await request(app)
      .post('/api/v1/ptr-records')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ ip_address: '192.168.1.1', hostname: 'host1.example.com' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  test('PUT /api/v1/ptr-records/:id updates record', async () => {
    const res = await request(app)
      .put('/api/v1/ptr-records/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ ttl: 7200 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('DELETE /api/v1/ptr-records/:id soft deletes record', async () => {
    const res = await request(app)
      .delete('/api/v1/ptr-records/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(204);
  });

  test('POST without ip_address returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/ptr-records')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ hostname: 'host1.example.com' });

    expect(res.status).toBe(422);
  });

  test('GET without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/ptr-records');

    expect(res.status).toBe(401);
  });
});
