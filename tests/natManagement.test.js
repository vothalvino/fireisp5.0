// =============================================================================
// FireISP 5.0 — NAT Pool Management Route Tests (§5 Dual Stack)
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

const samplePool = {
  id: 1,
  organization_id: 10,
  name: 'CGNAT Pool',
  nat_type: 'cgnat',
  external_ip_start: '100.64.0.1',
  external_ip_end: '100.64.0.254',
  internal_subnet: '10.0.0.0/8',
  port_range_start: 1024,
  port_range_end: 65535,
  max_ports_per_subscriber: 512,
  status: 'active',
  notes: null,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('nat_pools')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'nat_pools.view' }]]);
    }
    // Count query
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // INSERT for nat_pools
    if (typeof sql === 'string' && sql.includes('INSERT INTO nat_pools')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // UPDATE for nat_pools
    if (typeof sql === 'string' && sql.includes('UPDATE nat_pools')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Soft delete
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default: return sample row
    return Promise.resolve([[samplePool]]);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NAT Pool routes', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/nat-pools returns list', async () => {
    const res = await request(app)
      .get('/api/v1/nat-pools')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/nat-pools/:id returns single pool', async () => {
    const res = await request(app)
      .get('/api/v1/nat-pools/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/nat-pools creates pool', async () => {
    const res = await request(app)
      .post('/api/v1/nat-pools')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'CGNAT Pool', external_ip_start: '100.64.0.1', external_ip_end: '100.64.0.254' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  test('PUT /api/v1/nat-pools/:id updates pool', async () => {
    const res = await request(app)
      .put('/api/v1/nat-pools/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ max_ports_per_subscriber: 1024 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('DELETE /api/v1/nat-pools/:id soft deletes pool', async () => {
    const res = await request(app)
      .delete('/api/v1/nat-pools/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(204);
  });

  test('POST without name returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/nat-pools')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ external_ip_start: '100.64.0.1', external_ip_end: '100.64.0.254' });

    expect(res.status).toBe(422);
  });

  test('GET without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/nat-pools');

    expect(res.status).toBe(401);
  });
});
