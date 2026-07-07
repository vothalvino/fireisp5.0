// =============================================================================
// FireISP 5.0 — IPv6 Transition Mechanism Route Tests (§5 Dual Stack)
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

const sample6rd = {
  id: 1,
  organization_id: 10,
  name: '6rd Config 1',
  border_relay_ip: '203.0.113.1',
  ipv6_prefix: '2001:db8::/32',
  ipv4_mask_len: 0,
  mtu: 1480,
  status: 'active',
  notes: null,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('tunnel_6rd') && !sql.includes('ds_lite') && !sql.includes('map_rules') && !sql.includes('xlat464')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'transition_mechanisms.view' }]]);
    }
    // Count query
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // INSERT for transition mechanism tables
    if (typeof sql === 'string' && (
      sql.includes('INSERT INTO tunnel_6rd_configs') ||
      sql.includes('INSERT INTO ds_lite_configs') ||
      sql.includes('INSERT INTO map_rules') ||
      sql.includes('INSERT INTO xlat464_configs')
    )) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // UPDATE for transition mechanism tables
    if (typeof sql === 'string' && (
      sql.includes('UPDATE tunnel_6rd_configs') ||
      sql.includes('UPDATE ds_lite_configs') ||
      sql.includes('UPDATE map_rules') ||
      sql.includes('UPDATE xlat464_configs')
    )) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Soft delete
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default: return sample row
    return Promise.resolve([[sample6rd]]);
  });
}

// ---------------------------------------------------------------------------
// Tests — 6rd
// ---------------------------------------------------------------------------

describe('Transition Mechanism routes — 6rd', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/transition-mechanisms/6rd returns list', async () => {
    const res = await request(app)
      .get('/api/v1/transition-mechanisms/6rd')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/transition-mechanisms/6rd/:id returns single config', async () => {
    const res = await request(app)
      .get('/api/v1/transition-mechanisms/6rd/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
  });

  test('POST /api/v1/transition-mechanisms/6rd creates config', async () => {
    const res = await request(app)
      .post('/api/v1/transition-mechanisms/6rd')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: '6rd Config 1', border_relay_ip: '203.0.113.1', ipv6_prefix: '2001:db8::/32' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  test('PUT /api/v1/transition-mechanisms/6rd/:id updates config', async () => {
    const res = await request(app)
      .put('/api/v1/transition-mechanisms/6rd/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ mtu: 1460 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('DELETE /api/v1/transition-mechanisms/6rd/:id soft deletes config', async () => {
    const res = await request(app)
      .delete('/api/v1/transition-mechanisms/6rd/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(204);
  });

  test('POST without name returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/transition-mechanisms/6rd')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ border_relay_ip: '203.0.113.1', ipv6_prefix: '2001:db8::/32' });

    expect(res.status).toBe(422);
  });

  test('GET without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/transition-mechanisms/6rd');

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Mass-assignment protection tests
// ---------------------------------------------------------------------------

describe('Transition Mechanism routes — mass-assignment guard', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('POST /6rd strips protected columns (id, organization_id, deleted_at, updated_at)', async () => {
    let capturedSql = null;
    let capturedParams = null;
    db.query.mockImplementation((sql, params) => {
      if (sql && sql.includes('INSERT INTO tunnel_6rd_configs')) {
        capturedSql = sql;
        capturedParams = params;
        return Promise.resolve([{ insertId: 1 }]);
      }
      if (sql && sql.includes('WHERE id = ?') && !sql.includes('tunnel_6rd') && !sql.includes('ds_lite') && !sql.includes('map_rules') && !sql.includes('xlat464')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (sql && sql.includes('permissions')) {
        return Promise.resolve([[{ id: 1, name: 'transition_mechanisms.create' }]]);
      }
      if (sql && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[sample6rd]]);
    });

    const res = await request(app)
      .post('/api/v1/transition-mechanisms/6rd')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: '6rd Config 1',
        border_relay_ip: '203.0.113.1',
        ipv6_prefix: '2001:db8::/32',
        // mass-assignment attempt
        id: 9999,
        organization_id: 42,
        deleted_at: '2000-01-01',
        updated_at: '2000-01-01',
        created_at: '2000-01-01',
      });

    expect(res.status).toBe(201);
    // The INSERT column list must not contain any protected key
    expect(capturedSql).not.toBeNull();
    expect(capturedSql).not.toContain('`id`');
    expect(capturedSql).not.toContain('`deleted_at`');
    expect(capturedSql).not.toContain('`updated_at`');
    expect(capturedSql).not.toContain('`created_at`');
    // organization_id must be present and bound to 10 (from req.orgId), not 42
    expect(capturedSql).toContain('`organization_id`');
    expect(capturedParams).toContain(10);
    expect(capturedParams).not.toContain(42);
  });

  test('PUT /6rd/:id strips protected columns (organization_id, deleted_at, updated_at)', async () => {
    let capturedUpdateSql = null;
    let capturedUpdateParams = null;
    db.query.mockImplementation((sql, params) => {
      if (sql && sql.includes('UPDATE tunnel_6rd_configs')) {
        capturedUpdateSql = sql;
        capturedUpdateParams = params;
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql && sql.includes('SELECT id FROM tunnel_6rd_configs')) {
        return Promise.resolve([[{ id: 1 }]]);
      }
      if (sql && sql.includes('WHERE id = ?') && !sql.includes('tunnel_6rd') && !sql.includes('ds_lite') && !sql.includes('map_rules') && !sql.includes('xlat464')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (sql && sql.includes('permissions')) {
        return Promise.resolve([[{ id: 1, name: 'transition_mechanisms.update' }]]);
      }
      if (sql && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[sample6rd]]);
    });

    const res = await request(app)
      .put('/api/v1/transition-mechanisms/6rd/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        mtu: 1460,
        // mass-assignment attempt
        organization_id: 42,
        deleted_at: '2000-01-01',
        updated_at: '2000-01-01',
        id: 9999,
      });

    expect(res.status).toBe(200);
    // The UPDATE SET clause must not assign any protected key
    expect(capturedUpdateSql).not.toBeNull();
    expect(capturedUpdateSql).not.toContain('`id` =');
    expect(capturedUpdateSql).not.toContain('`organization_id` =');
    expect(capturedUpdateSql).not.toContain('`deleted_at` =');
    expect(capturedUpdateSql).not.toContain('`updated_at` =');
    expect(capturedUpdateSql).not.toContain('`created_at` =');
    // the only permitted field, mtu, must be assigned and its value bound
    expect(capturedUpdateSql).toContain('`mtu` =');
    expect(capturedUpdateParams).toContain(1460);
  });
});
