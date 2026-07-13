// =============================================================================
// FireISP 5.0 — Discovery Scan Route Tests (§6.1)
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
const Device = require('../src/models/Device');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const sampleScan = {
  id: 1,
  organization_id: 10,
  name: 'Office Network Scan',
  cidr_ranges: '["192.168.1.0/24"]',
  snmp_version: 'v2c',
  snmp_community: 'public',
  snmp_v3_auth_key_encrypted: 'PLAINTEXT_AUTH_KEY',
  snmp_v3_priv_key_encrypted: 'PLAINTEXT_PRIV_KEY',
  snmp_port: 161,
  timeout_ms: 3000,
  concurrency: 50,
  status: 'pending',
  scan_started_at: null,
  scan_completed_at: null,
  total_hosts: null,
  scanned_hosts: 0,
  discovered_hosts: 0,
  error_message: null,
  created_by: 1,
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('discovery')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[
        { id: 1, name: 'discovery_scans.view' },
        { id: 2, name: 'discovery_scans.create' },
        { id: 3, name: 'discovery_scans.update' },
        { id: 4, name: 'discovery_scans.delete' },
      ]]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO discovery_scans')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE discovery_scans')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('discovery_results')) {
      return Promise.resolve([[{
        id: 1,
        scan_id: 1,
        organization_id: 10,
        ip_address: '192.168.1.1',
        hostname: 'router-01',
        status: 'pending_review',
        suggested_profile_name: 'Generic IF-MIB',
      }]]);
    }
    // Default: return sample scan
    return Promise.resolve([[sampleScan]]);
  });
}

describe('Discovery Scan routes', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /api/v1/discovery-scans returns list', async () => {
    const res = await request(app)
      .get('/api/v1/discovery-scans')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/discovery-scans never leaks the encrypted SNMPv3 columns', async () => {
    const res = await request(app)
      .get('/api/v1/discovery-scans')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    res.body.data.forEach((row) => {
      expect(row).not.toHaveProperty('snmp_v3_auth_key_encrypted');
      expect(row).not.toHaveProperty('snmp_v3_priv_key_encrypted');
    });
    expect(JSON.stringify(res.body)).not.toContain('PLAINTEXT');
    expect(res.body.data[0]).toMatchObject({ has_snmp_v3_auth_key: true, has_snmp_v3_priv_key: true });
  });

  test('GET /api/v1/discovery-scans/:id returns single scan', async () => {
    const res = await request(app)
      .get('/api/v1/discovery-scans/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
    expect(res.body.data).not.toHaveProperty('snmp_v3_auth_key_encrypted');
    expect(res.body.data).not.toHaveProperty('snmp_v3_priv_key_encrypted');
    expect(res.body.data).toMatchObject({ has_snmp_v3_auth_key: true, has_snmp_v3_priv_key: true });
  });

  test('POST /api/v1/discovery-scans creates a scan', async () => {
    const res = await request(app)
      .post('/api/v1/discovery-scans')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'Office Network Scan',
        cidr_ranges: ['192.168.1.0/24'],
        snmp_version: 'v2c',
        snmp_community: 'public',
      });

    expect(res.status).toBe(201);
  });

  test('POST /api/v1/discovery-scans returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/discovery-scans')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ cidr_ranges: ['192.168.1.0/24'] });

    expect(res.status).toBe(422);
  });

  test('POST /api/v1/discovery-scans returns 422 when cidr_ranges is missing', async () => {
    const res = await request(app)
      .post('/api/v1/discovery-scans')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Test Scan' });

    expect(res.status).toBe(422);
  });

  test('GET /api/v1/discovery-scans/:id/results returns results', async () => {
    const res = await request(app)
      .get('/api/v1/discovery-scans/1/results')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/discovery-scans');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /:id/results/:resultId/onboard — cross-tenant guards
// (adversarial-review finding on fix/diagnostic-engine-blindness-client-id:
// this handler builds a Device.create payload from `...req.body` with no
// validate() schema and no org guard — once devices.client_id became
// fillable, an org-A caller could persist a device linked to an org-B
// client, and a pre-existing field-order bug let a caller-supplied
// organization_id in the body override the caller's own org entirely.)
// =============================================================================
describe('POST /:id/results/:resultId/onboard — cross-tenant guards', () => {
  const token = adminToken();

  const discoveryResult = {
    id: 5,
    scan_id: 1,
    organization_id: 10,
    ip_address: '192.168.1.50',
    hostname: 'onu-50',
    manufacturer: 'Huawei',
    model: 'HG8245',
    device_type: 'onu',
    snmp_version: 2,
    suggested_profile_id: null,
    status: 'pending_review',
  };

  function mockUserAndResult(extra) {
    // Order matters: `extra` (e.g. the `clients` FK lookup) must be checked
    // BEFORE the generic "WHERE id = ?" fallback below, since BOTH the user
    // lookup (`SELECT * FROM \`users\` WHERE id = ?`) and Client.findById
    // (`SELECT * FROM \`clients\` WHERE id = ? AND ...`) match "WHERE id = ?"
    // — and BaseModel backtick-quotes table names, so a naive
    // `sql.includes('FROM users')` never matches at all (see agent-memory
    // testing-conventions.md).
    db.query.mockImplementation((sql) => {
      if (extra) {
        const handled = extra(sql);
        if (handled !== undefined) return handled;
      }
      if (typeof sql === 'string' && sql.includes('FROM discovery_results')) {
        return Promise.resolve([[discoveryResult]]);
      }
      if (typeof sql === 'string' && sql.includes('UPDATE discovery_results')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('discovery')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      return Promise.resolve([[]]);
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('rejects a client_id belonging to another organization with 422 and never creates the device', async () => {
    jest.spyOn(Device, 'create').mockResolvedValue({ id: 999 });
    mockUserAndResult((sql) => {
      if (sql.includes('clients')) return Promise.resolve([[]]); // not found in this org
    });

    const res = await request(app)
      .post('/api/v1/discovery-scans/1/results/5/onboard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 999 });

    expect(res.status).toBe(422);
    expect(Device.create).not.toHaveBeenCalled();
  });

  test('persists a same-org client_id', async () => {
    jest.spyOn(Device, 'create').mockResolvedValue({ id: 78, organization_id: 10, client_id: 42 });
    mockUserAndResult((sql) => {
      if (sql.includes('clients')) return Promise.resolve([[{ id: 42, organization_id: 10 }]]);
    });

    const res = await request(app)
      .post('/api/v1/discovery-scans/1/results/5/onboard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 42 });

    expect(res.status).toBe(201);
    expect(Device.create).toHaveBeenCalledWith(expect.objectContaining({ client_id: 42, organization_id: 10 }));
  });

  test('a caller-supplied organization_id in the body can never override the caller organization', async () => {
    jest.spyOn(Device, 'create').mockResolvedValue({ id: 77, organization_id: 10 });
    mockUserAndResult();

    const res = await request(app)
      .post('/api/v1/discovery-scans/1/results/5/onboard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ organization_id: 999, name: 'renamed-onu' }); // attempted cross-tenant override

    expect(res.status).toBe(201);
    // The caller's own org must win regardless of what the body claims, while
    // an otherwise-harmless override (name) still passes through.
    expect(Device.create).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: 10, name: 'renamed-onu' }),
    );
  });
});
