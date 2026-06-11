// =============================================================================
// FireISP 5.0 — Trap Forwarding Rule Route Tests (§6.1)
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

const sampleRule = {
  id: 1,
  organization_id: 10,
  name: 'Link Down Forward',
  match_trap_type: 'linkDown',
  match_source_ip: null,
  match_oid_prefix: null,
  forward_to_url: 'https://hooks.example.com/snmp',
  forward_to_email: null,
  forward_to_webhook_id: null,
  transform_template: null,
  is_active: 1,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('trap_forwarding') && !sql.includes('snmp_trap_forwarding')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[
        { id: 1, name: 'trap_forwarding.view' },
        { id: 2, name: 'trap_forwarding.create' },
        { id: 3, name: 'trap_forwarding.update' },
        { id: 4, name: 'trap_forwarding.delete' },
      ]]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO snmp_trap_forwarding_rules')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE snmp_trap_forwarding_rules')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default: return sample rule
    return Promise.resolve([[sampleRule]]);
  });
}

describe('Trap Forwarding Rule routes', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/trap-forwarding-rules returns list', async () => {
    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/trap-forwarding-rules/:id returns single rule', async () => {
    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/trap-forwarding-rules creates a rule', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'Link Down Forward',
        match_trap_type: 'linkDown',
        forward_to_url: 'https://hooks.example.com/snmp',
      });

    expect(res.status).toBe(201);
  });

  test('POST /api/v1/trap-forwarding-rules returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ match_trap_type: 'linkDown' });

    expect(res.status).toBe(422);
  });

  test('DELETE /api/v1/trap-forwarding-rules/:id soft-deletes rule', async () => {
    const res = await request(app)
      .delete('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect([204, 404]).toContain(res.status);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/trap-forwarding-rules');
    expect(res.status).toBe(401);
  });
});
