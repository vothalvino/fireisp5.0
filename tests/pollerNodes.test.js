// =============================================================================
// FireISP 5.0 — Poller Nodes Route Tests (§6.4)
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

const sampleNode = {
  id: 1,
  node_identifier: 'node-us-east-1',
  name: 'US East Poller',
  status: 'active',
  api_url: 'https://poller.example.com',
  max_concurrent_polls: 10,
  current_queue_depth: 0,
  avg_poll_duration_ms: 250,
  last_heartbeat_at: null,
  created_at: '2026-06-11T00:00:00.000Z',
  updated_at: '2026-06-11T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('poller')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // Permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[
        { id: 1, name: 'poller_nodes.view' },
        { id: 2, name: 'poller_nodes.create' },
        { id: 3, name: 'poller_nodes.update' },
        { id: 4, name: 'poller_nodes.delete' },
        { id: 5, name: 'poller_performance.view' },
        { id: 6, name: 'polling_configs.view' },
        { id: 7, name: 'polling_configs.create' },
        { id: 8, name: 'polling_configs.update' },
        { id: 9, name: 'polling_configs.delete' },
      ]]);
    }
    // COUNT for list
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ 'COUNT(*)': 1 }]]);
    }
    // Single node fetch
    if (typeof sql === 'string' && sql.includes('poller_nodes') && sql.includes('WHERE')) {
      return Promise.resolve([[sampleNode]]);
    }
    // List nodes
    if (typeof sql === 'string' && sql.includes('poller_nodes')) {
      return Promise.resolve([[sampleNode]]);
    }
    // Performance snapshots
    if (typeof sql === 'string' && sql.includes('poller_performance_snapshots')) {
      return Promise.resolve([[{
        id: 1,
        poller_node_id: 1,
        node_name: 'US East Poller',
        snapshot_at: '2026-06-11T00:00:00.000Z',
        devices_polled: 20,
        devices_failed: 0,
        avg_poll_duration_ms: 250,
        queue_depth: 0,
        timeout_rate_pct: null,
      }]]);
    }
    // INSERT (create)
    if (typeof sql === 'string' && sql.includes('INSERT INTO poller_nodes')) {
      return Promise.resolve([{ insertId: 2, affectedRows: 1 }]);
    }
    // UPDATE
    if (typeof sql === 'string' && sql.includes('UPDATE poller_nodes')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // DELETE
    if (typeof sql === 'string' && sql.includes('DELETE FROM poller_nodes')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    return Promise.resolve([[sampleNode]]);
  });
}

describe('Poller Nodes routes (§6.4)', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  // =========================================================================
  // GET /api/v1/poller-nodes
  // =========================================================================
  test('GET /api/v1/poller-nodes returns paginated list', async () => {
    const res = await request(app)
      .get('/api/v1/poller-nodes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
  });

  test('GET /api/v1/poller-nodes returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/poller-nodes');
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // POST /api/v1/poller-nodes
  // =========================================================================
  test('POST /api/v1/poller-nodes creates a new node', async () => {
    const res = await request(app)
      .post('/api/v1/poller-nodes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ node_identifier: 'node-new', name: 'New Node', status: 'active', max_concurrent_polls: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  test('POST /api/v1/poller-nodes returns 422 when node_identifier missing', async () => {
    const res = await request(app)
      .post('/api/v1/poller-nodes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Missing Identifier' });

    expect(res.status).toBe(422);
  });

  // =========================================================================
  // PUT /api/v1/poller-nodes/:id
  // =========================================================================
  test('PUT /api/v1/poller-nodes/:id updates a node', async () => {
    const res = await request(app)
      .put('/api/v1/poller-nodes/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Updated Node', status: 'maintenance' });

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // DELETE /api/v1/poller-nodes/:id
  // =========================================================================
  test('DELETE /api/v1/poller-nodes/:id deletes a node', async () => {
    const res = await request(app)
      .delete('/api/v1/poller-nodes/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect([200, 204]).toContain(res.status);
  });

  // =========================================================================
  // GET /api/v1/poller-nodes/:id/performance
  // =========================================================================
  test('GET /api/v1/poller-nodes/:id/performance returns performance history', async () => {
    const res = await request(app)
      .get('/api/v1/poller-nodes/1/performance?hours=24')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('node_id', 1);
  });

  test('GET /api/v1/poller-nodes/abc/performance returns 422 for non-integer id', async () => {
    const res = await request(app)
      .get('/api/v1/poller-nodes/abc/performance')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(422);
  });
});
