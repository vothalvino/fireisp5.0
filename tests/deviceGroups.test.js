// =============================================================================
// FireISP 5.0 — Device Group Route Tests (§6.1)
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

jest.mock('net-snmp', () => ({}), { virtual: true });

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

const sampleGroup = {
  id: 1,
  organization_id: 10,
  name: 'Core Routers',
  description: 'Core routing infrastructure',
  group_type: 'type',
  color: '#3498db',
  status: 'active',
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
    // Fallback user lookup (WHERE id = ? queries not on our tables)
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('device_group')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'device_groups.view' }, { id: 2, name: 'device_groups.create' }, { id: 3, name: 'device_groups.update' }, { id: 4, name: 'device_groups.delete' }]]);
    }
    // Count query
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // INSERT for device_groups
    if (typeof sql === 'string' && sql.includes('INSERT INTO device_groups')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // UPDATE for device_groups
    if (typeof sql === 'string' && sql.includes('UPDATE device_groups')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // device_group_members queries
    if (typeof sql === 'string' && sql.includes('device_group_members')) {
      return Promise.resolve([[{ id: 5, name: 'Router-01', type: 'router', ip_address: '192.168.1.1', status: 'active' }]]);
    }
    // Default: return sample row
    return Promise.resolve([[sampleGroup]]);
  });
}

describe('Device Group routes', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/device-groups returns list', async () => {
    const res = await request(app)
      .get('/api/v1/device-groups')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/device-groups/:id returns single group', async () => {
    const res = await request(app)
      .get('/api/v1/device-groups/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/device-groups creates a group', async () => {
    const res = await request(app)
      .post('/api/v1/device-groups')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Core Routers', group_type: 'type' });

    expect(res.status).toBe(201);
  });

  test('POST /api/v1/device-groups returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/device-groups')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ group_type: 'type' });

    expect(res.status).toBe(422);
  });

  test('PUT /api/v1/device-groups/:id updates a group', async () => {
    const res = await request(app)
      .put('/api/v1/device-groups/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Updated Name' });

    expect([200, 404]).toContain(res.status);
  });

  test('GET /api/v1/device-groups/:id/members returns member list', async () => {
    const res = await request(app)
      .get('/api/v1/device-groups/1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('POST /api/v1/device-groups/:id/members adds members', async () => {
    const res = await request(app)
      .post('/api/v1/device-groups/1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ device_ids: [5, 6] });

    expect([200, 404]).toContain(res.status);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/device-groups');
    expect(res.status).toBe(401);
  });
});
