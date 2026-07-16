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

  // ---------------------------------------------------------------------
  // Cross-tenant leak regressions
  // ---------------------------------------------------------------------

  test('GET /api/v1/snmp-metrics/devices scopes the device list to the caller org', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics/devices')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);

    const deviceListCall = db.query.mock.calls.find(
      ([sql]) => sql.includes('FROM devices') && sql.includes('snmp_enabled'),
    );
    expect(deviceListCall).toBeDefined();
    expect(deviceListCall[0]).toMatch(/organization_id = \?/);
    expect(deviceListCall[1]).toEqual([10]);
  });

  test('GET /api/v1/snmp-metrics returns 404 when device_id belongs to a different org', async () => {
    db.query.mockImplementation((sql) => {
      // Ownership check first (more specific match) — simulate "no row in this org".
      if (sql.includes('FROM devices') && sql.includes('organization_id = ?')) {
        return Promise.resolve([[]]);
      }
      if (sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/snmp-metrics?device_id=999&resolution=1hr')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(404);
  });

  test('GET /api/v1/snmp-metrics raw resolution now selects uptime_ticks', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-metrics?device_id=5&resolution=raw')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);

    const rawCall = db.query.mock.calls.find(
      ([sql]) => sql.includes('FROM snmp_metrics') && sql.includes('polled_at AS ts'),
    );
    expect(rawCall).toBeDefined();
    expect(rawCall[0]).toMatch(/uptime_ticks/);
  });

  // ---------------------------------------------------------------------
  // Fleet at-a-glance endpoint
  // ---------------------------------------------------------------------

  describe('GET /api/v1/snmp-metrics/fleet', () => {
    const fleetDevices = [
      { id: 5, name: 'Core-Router-01', type: 'router', status: 'online', site_id: 1, consecutive_poll_failures: 0, last_polled_at: '2026-07-16T10:00:00.000Z', last_poll_error: null },
      { id: 6, name: 'Switch-02', type: 'switch', status: 'online', site_id: 1, consecutive_poll_failures: 0, last_polled_at: null, last_poll_error: null },
    ];
    const fleetLatest = [
      { device_id: 5, cpu_usage: 42, memory_usage: 55, uptime_ticks: 123456, polled_at: '2026-07-16T10:00:00.000Z' },
    ];
    const fleetSpark = [
      { device_id: 5, polled_at: '2026-07-16T09:00:00.000Z', cpu_usage: 40 },
      { device_id: 5, polled_at: '2026-07-16T09:30:00.000Z', cpu_usage: 41 },
    ];
    const fleetTraffic = [
      // newest bucket first, as the query's ORDER BY minute_bucket DESC returns them
      { device_id: 5, minute_bucket: 1000, ts: '2026-07-16T10:00:00.000Z', in_octets: 2000, out_octets: 1000, iface_count: 2, iface_signature: '1,2' },
      { device_id: 5, minute_bucket: 999, ts: '2026-07-16T09:55:00.000Z', in_octets: 1000, out_octets: 500, iface_count: 2, iface_signature: '1,2' },
    ];

    function mockFleetDb({ devices = fleetDevices, latest = fleetLatest, spark = fleetSpark, traffic = fleetTraffic } = {}) {
      db.query.mockImplementation((sql) => {
        if (sql.includes('minute_bucket')) return Promise.resolve([traffic]);
        if (sql.includes('INTERVAL 2 HOUR')) return Promise.resolve([spark]);
        if (sql.includes('uptime_ticks')) return Promise.resolve([latest]);
        if (sql.includes('consecutive_poll_failures')) return Promise.resolve([devices]);
        if (sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
        }
        return Promise.resolve([[]]);
      });
    }

    test('returns per-device latest/spark/traffic shape, org-scoped with LIMIT 500', async () => {
      mockFleetDb();

      const res = await request(app)
        .get('/api/v1/snmp-metrics/fleet')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-Id', '10');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);

      const withData = res.body.data.find(d => d.id === 5);
      expect(withData.latest).toEqual(expect.objectContaining({ cpu_usage: 42, memory_usage: 55, uptime_ticks: 123456 }));
      expect(withData.cpu_spark).toHaveLength(2);
      expect(withData.traffic_samples).toHaveLength(2);
      // Reversed into chronological (oldest-first) order for a straightforward delta calc.
      expect(withData.traffic_samples[0].in_octets).toBe(1000);
      expect(withData.traffic_samples[1].in_octets).toBe(2000);
      // interface_signature propagates through so the frontend can refuse to
      // compute a rate when the two samples' interface membership differs.
      expect(withData.traffic_samples[0].interface_signature).toBe('1,2');
      expect(withData.traffic_samples[1].interface_signature).toBe('1,2');

      const noData = res.body.data.find(d => d.id === 6);
      expect(noData.latest).toBeNull();
      expect(noData.cpu_spark).toEqual([]);
      expect(noData.traffic_samples).toEqual([]);

      const devicesCall = db.query.mock.calls.find(([sql]) => sql.includes('consecutive_poll_failures'));
      expect(devicesCall[0]).toMatch(/organization_id = \?/);
      expect(devicesCall[0]).toMatch(/LIMIT 500/);
      expect(devicesCall[1]).toEqual([10]);

      // The traffic-sample query groups per device *and* per minute bucket,
      // and carries the interface-membership signature needed to guard
      // against a reappearing-interface fabricated rate (see rateTransform).
      const trafficCall = db.query.mock.calls.find(([sql]) => sql.includes('minute_bucket'));
      expect(trafficCall[0]).toMatch(/GROUP BY device_id, minute_bucket/);
      expect(trafficCall[0]).toMatch(/COUNT\(DISTINCT interface_id\)/);
      expect(trafficCall[0]).toMatch(/GROUP_CONCAT\(DISTINCT interface_id ORDER BY interface_id\)/);
    });

    test('a reappearing interface between two buckets carries a DIFFERENT interface_signature (never silently merged)', async () => {
      mockFleetDb({
        traffic: [
          { device_id: 5, minute_bucket: 1000, ts: '2026-07-16T10:00:00.000Z', in_octets: 50_000_000_000, out_octets: 20_000_000_000, iface_count: 3, iface_signature: '1,2,3' },
          { device_id: 5, minute_bucket: 999, ts: '2026-07-16T09:55:00.000Z', in_octets: 1000, out_octets: 500, iface_count: 2, iface_signature: '1,2' },
        ],
      });

      const res = await request(app)
        .get('/api/v1/snmp-metrics/fleet')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-Id', '10');

      expect(res.status).toBe(200);
      const withData = res.body.data.find(d => d.id === 5);
      // Route itself does no rate math — it just needs to carry the two
      // distinct signatures through honestly; the frontend refuses to diff
      // samples whose interface_signature differs.
      expect(withData.traffic_samples[0].interface_signature).toBe('1,2');
      expect(withData.traffic_samples[1].interface_signature).toBe('1,2,3');
      expect(withData.traffic_samples[0].interface_signature)
        .not.toBe(withData.traffic_samples[1].interface_signature);
    });

    test('returns an empty data array when the org has no SNMP-enabled devices (no N+1 follow-up queries)', async () => {
      mockFleetDb({ devices: [] });

      const res = await request(app)
        .get('/api/v1/snmp-metrics/fleet')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-Id', '10');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);

      // Short-circuits before issuing the latest/spark/traffic follow-up queries.
      expect(db.query.mock.calls.some(([sql]) => sql.includes('minute_bucket'))).toBe(false);
    });
  });
});
