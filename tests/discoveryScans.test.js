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

  test('GET /api/v1/discovery-scans/:id returns single scan', async () => {
    const res = await request(app)
      .get('/api/v1/discovery-scans/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
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
