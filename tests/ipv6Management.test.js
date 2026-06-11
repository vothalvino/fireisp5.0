// =============================================================================
// FireISP 5.0 — IPv6 Management Route Tests (§5 Dual Stack)
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

const samplePolicy = {
  id: 1,
  organization_id: 10,
  name: 'Strict RA Guard',
  switch_id: null,
  port_pattern: 'ge-0/0/*',
  policy_type: 'strict',
  status: 'active',
  notes: null,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ra_guard')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'ra_guard.view' }]]);
    }
    // Count query
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // INSERT for ra_guard_policies
    if (typeof sql === 'string' && sql.includes('INSERT INTO ra_guard_policies')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // UPDATE for ra_guard_policies
    if (typeof sql === 'string' && sql.includes('UPDATE ra_guard_policies')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Soft delete
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default: return sample row
    return Promise.resolve([[samplePolicy]]);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IPv6 Management routes — RA Guard', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/ipv6/ra-guard returns list', async () => {
    const res = await request(app)
      .get('/api/v1/ipv6/ra-guard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/ipv6/ra-guard/:id returns single policy', async () => {
    const res = await request(app)
      .get('/api/v1/ipv6/ra-guard/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/ipv6/ra-guard creates policy', async () => {
    const res = await request(app)
      .post('/api/v1/ipv6/ra-guard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Strict RA Guard' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  test('PUT /api/v1/ipv6/ra-guard/:id updates policy', async () => {
    const res = await request(app)
      .put('/api/v1/ipv6/ra-guard/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ policy_type: 'loose' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('DELETE /api/v1/ipv6/ra-guard/:id soft deletes policy', async () => {
    const res = await request(app)
      .delete('/api/v1/ipv6/ra-guard/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(204);
  });

  test('POST without name returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/ipv6/ra-guard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ policy_type: 'strict' });

    expect(res.status).toBe(422);
  });

  test('GET without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/ipv6/ra-guard');

    expect(res.status).toBe(401);
  });
});

describe('IPv6 Management routes — Subnet Planner', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/ipv6/subnet-plan returns subnets for IPv4', async () => {
    const res = await request(app)
      .get('/api/v1/ipv6/subnet-plan')
      .query({ network: '192.168.0.0/16', prefix_len: '16', sub_prefix_len: '24' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(256); // 2^(24-16) = 256
    expect(res.body.data[0]).toBe('192.168.0.0/24');
  });

  test('GET /api/v1/ipv6/subnet-plan returns subnets for IPv6', async () => {
    const res = await request(app)
      .get('/api/v1/ipv6/subnet-plan')
      .query({ network: '2001:db8::/32', prefix_len: '32', sub_prefix_len: '48' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(65536); // 2^(48-32) = 65536
  });

  test('GET /api/v1/ipv6/subnet-plan without network returns 422', async () => {
    const res = await request(app)
      .get('/api/v1/ipv6/subnet-plan')
      .query({ prefix_len: '16', sub_prefix_len: '24' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(422);
  });

  test('GET /api/v1/ipv6/subnet-plan without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/ipv6/subnet-plan')
      .query({ network: '10.0.0.0/8', prefix_len: '8', sub_prefix_len: '16' });

    expect(res.status).toBe(401);
  });
});

describe('IP Pool — IPv6 columns (§5 dual stack)', () => {
  const token = adminToken();

  function mockDbIpPool() {
    db.query.mockImplementation((sql) => {
      // Auth: user lookup
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ip_pools')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      // RBAC
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'ip_pools.create' }]]);
      }
      if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO `ip_pools`')) {
        return Promise.resolve([{ insertId: 1 }]);
      }
      if (typeof sql === 'string' && sql.includes('UPDATE `ip_pools`')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      // Overlap detection query: SELECT * FROM ip_pools WHERE deleted_at IS NULL ...
      // Return empty array so assertNoOverlap finds no conflict
      if (typeof sql === 'string' && sql.includes('FROM ip_pools') && sql.includes('deleted_at IS NULL') && !sql.includes('WHERE id')) {
        return Promise.resolve([[]]);
      }
      // Single pool fetch (findByIdOrFail for PUT)
      if (typeof sql === 'string' && sql.includes('FROM `ip_pools`')) {
        return Promise.resolve([[{
          id: 1, organization_id: 10, name: 'IPv6 Pool', network: '2001:db8::/32',
          ip_version: '6', status: 'active', dhcpv6_mode: 'stateful',
          ra_enabled: 1, slaac_prefix: '2001:db8::/32',
          ra_lifetime_seconds: 3600, region_name: 'North',
          deleted_at: null,
        }]]);
      }
      return Promise.resolve([[{
        id: 1, organization_id: 10, name: 'IPv6 Pool', network: '2001:db8::/32',
        ip_version: '6', status: 'active', dhcpv6_mode: 'stateful',
        ra_enabled: 1, slaac_prefix: '2001:db8::/32',
        ra_lifetime_seconds: 3600, region_name: 'North',
        deleted_at: null,
      }]]);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbIpPool();
  });

  test('POST /api/v1/ip-pools with DHCPv6 columns returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/ip-pools')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'IPv6 Pool',
        network: '2001:db8::/32',
        ip_version: '6',
        dhcpv6_mode: 'stateful',
        ra_enabled: true,
        slaac_prefix: '2001:db8::/32',
      });

    expect(res.status).toBe(201);
  });

  test('PUT /api/v1/ip-pools/1 with ra_lifetime_seconds and region_name returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/ip-pools/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ ra_lifetime_seconds: 3600, region_name: 'North' });

    expect(res.status).toBe(200);
  });
});
