// =============================================================================
// FireISP 5.0 — DHCP Servers Route Tests (§5 Dual Stack)
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

const sampleServer = {
  id: 1,
  organization_id: 10,
  name: 'Kea DHCP',
  server_type: 'kea',
  host: '192.168.1.10',
  port: 8000,
  api_url: null,
  api_token: null,
  status: 'active',
  notes: null,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // Fallback user lookup (without FROM users)
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dhcp') && !sql.includes('nat') && !sql.includes('ptr')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'dhcp_servers.view' }]]);
    }
    // Count query
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // INSERT for dhcp_servers
    if (typeof sql === 'string' && sql.includes('INSERT INTO dhcp_servers')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // UPDATE for dhcp_servers
    if (typeof sql === 'string' && sql.includes('UPDATE dhcp_servers')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Soft delete
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default: return sample row
    return Promise.resolve([[sampleServer]]);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DHCP Server routes', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/dhcp-servers returns list', async () => {
    const res = await request(app)
      .get('/api/v1/dhcp-servers')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/dhcp-servers/:id returns single server', async () => {
    const res = await request(app)
      .get('/api/v1/dhcp-servers/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/dhcp-servers creates server', async () => {
    const res = await request(app)
      .post('/api/v1/dhcp-servers')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Kea DHCP', host: '192.168.1.10' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  test('PUT /api/v1/dhcp-servers/:id updates server', async () => {
    const res = await request(app)
      .put('/api/v1/dhcp-servers/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ port: 8080 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('DELETE /api/v1/dhcp-servers/:id soft deletes server', async () => {
    const res = await request(app)
      .delete('/api/v1/dhcp-servers/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(204);
  });

  test('POST without name returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/dhcp-servers')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ host: '192.168.1.10' });

    expect(res.status).toBe(422);
  });

  test('GET without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/dhcp-servers');

    expect(res.status).toBe(401);
  });
});
