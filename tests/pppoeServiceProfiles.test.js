// =============================================================================
// FireISP 5.0 — PPPoE Service Profile Route Tests (§4B)
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

const profile = {
  id: 1,
  organization_id: 10,
  name: 'Standard PPPoE',
  service_name: 'isp-service',
  mtu: 1492,
  mru: 1492,
  auth_methods: 'pap,chap,mschapv2',
  dns_primary: '8.8.8.8',
  dns_secondary: '8.8.4.4',
  session_timeout_seconds: null,
  idle_timeout_seconds: null,
  rate_limit_override: null,
  address_list: null,
  filter_id: null,
  status: 'active',
  notes: null,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC: permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'pppoe_service_profiles.view' }]]);
    }
    // Count query
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // Model INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO `pppoe_service_profiles`')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // Model UPDATE
    if (typeof sql === 'string' && sql.includes('UPDATE `pppoe_service_profiles`')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Soft delete
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default list / get / restore
    return Promise.resolve([[profile]]);
  });
}

describe('PPPoE Service Profile routes', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/pppoe-service-profiles returns list', async () => {
    const res = await request(app)
      .get('/api/v1/pppoe-service-profiles')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/pppoe-service-profiles/:id returns single profile', async () => {
    const res = await request(app)
      .get('/api/v1/pppoe-service-profiles/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/pppoe-service-profiles creates profile', async () => {
    const res = await request(app)
      .post('/api/v1/pppoe-service-profiles')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Standard PPPoE', mtu: 1492 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  test('PUT /api/v1/pppoe-service-profiles/:id updates profile', async () => {
    const res = await request(app)
      .put('/api/v1/pppoe-service-profiles/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ mtu: 1480, dns_primary: '1.1.1.1' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('DELETE /api/v1/pppoe-service-profiles/:id soft deletes profile', async () => {
    const res = await request(app)
      .delete('/api/v1/pppoe-service-profiles/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(204);
  });

  test('POST without name returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/pppoe-service-profiles')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ mtu: 1492 });

    expect(res.status).toBe(422);
  });

  test('GET without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/pppoe-service-profiles');

    expect(res.status).toBe(401);
  });
});
