// =============================================================================
// FireISP 5.0 — SNMP Metrics Extended Route Tests (§6.2/6.3)
// Tests new endpoints: top-talkers, interfaces/:deviceId, errors
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

const sampleDevice = {
  id: 5,
  organization_id: 10,
  name: 'Core-Router-01',
  ip_address: '10.0.0.1',
  snmp_profile_id: 1,
  status: 'active',
};

const sampleMetricRow = {
  period_start: '2026-06-11T00:00:00.000Z',
  interface_id: 'eth0',
  avg_if_in_octets: 1000000,
  avg_if_out_octets: 500000,
  avg_if_in_errors: 0,
  avg_if_out_errors: 0,
  avg_if_in_discards: 0,
  avg_if_out_discards: 0,
  sample_count: 12,
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('snmp_metrics')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // Permissions
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[
        { id: 1, name: 'snmp_metrics.view' },
        { id: 2, name: 'snmp_metrics.top_talkers' },
        { id: 3, name: 'snmp_metrics.interfaces' },
      ]]);
    }
    // Device lookup for /interfaces/:deviceId
    if (typeof sql === 'string' && sql.includes('FROM devices') && sql.includes('organization_id = ?')) {
      return Promise.resolve([[sampleDevice]]);
    }
    // Top talkers
    if (typeof sql === 'string' && sql.includes('total_bytes')) {
      return Promise.resolve([[{
        device_id: 5,
        device_name: 'Core-Router-01',
        ip_address: '10.0.0.1',
        interface_id: 'eth0',
        total_bytes: 5000000,
        total_in_bytes: 3000000,
        total_out_bytes: 2000000,
        samples: 24,
      }]]);
    }
    // Interface stats (latest per interface)
    if (typeof sql === 'string' && sql.includes('INNER JOIN') && sql.includes('latest')) {
      return Promise.resolve([[{
        interface_id: 'eth0',
        if_in_octets_avg: 1000000,
        if_out_octets_avg: 500000,
        period_start: '2026-06-11T00:00:00.000Z',
      }]]);
    }
    // Error counters
    if (typeof sql === 'string' && sql.includes('total_in_errors')) {
      return Promise.resolve([[{
        interface_id: 'eth0',
        total_in_errors: 5,
        total_out_errors: 2,
        total_in_discards: 1,
        total_out_discards: 0,
        samples: 24,
      }]]);
    }
    // Raw/1hr/1day metric data
    if (typeof sql === 'string' && sql.includes('snmp_metrics')) {
      return Promise.resolve([[sampleMetricRow]]);
    }
    // Default
    return Promise.resolve([[sampleDevice]]);
  });
}

describe('SNMP Metrics extended routes (§6.2/6.3)', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  // Existing endpoint sanity check
  test('GET /api/v1/snmp-metrics returns time-series data', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics?device_id=5&resolution=1hr')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });

  test('GET /api/v1/snmp-metrics returns 422 when device_id missing', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(422);
  });

  // §6.3 Top talkers
  test('GET /api/v1/snmp-metrics/top-talkers returns list', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics/top-talkers?hours=24&limit=5')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('lookback_hours', 24);
  });

  // §6.3 Per-interface utilization
  test('GET /api/v1/snmp-metrics/interfaces/:deviceId returns stats', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics/interfaces/5')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.meta).toHaveProperty('device_id', 5);
  });

  test('GET /api/v1/snmp-metrics/interfaces/:deviceId returns 422 for non-integer', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics/interfaces/abc')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(422);
  });

  // §6.3 Error counters
  test('GET /api/v1/snmp-metrics/errors returns error counters', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics/errors?device_id=5&hours=24')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.meta).toHaveProperty('device_id', 5);
  });

  test('GET /api/v1/snmp-metrics/errors returns 422 when device_id missing', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics/errors')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(422);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/snmp-metrics/top-talkers');
    expect(res.status).toBe(401);
  });
});
