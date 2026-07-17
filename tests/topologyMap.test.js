// =============================================================================
// FireISP 5.0 — Topology Map Route Tests (§13)
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

const sampleGeofence = {
  id: 1,
  organization_id: 10,
  name: 'Test Geofence',
  type: 'radius',
  center_lat: 19.4326,
  center_lng: -99.1332,
  radius_meters: 500,
  device_id: null,
  boundary: null,
  is_active: 1,
  description: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

const sampleInfrastructure = {
  id: 1,
  organization_id: 10,
  name: 'Test Tower',
  type: 'tower',
  latitude: 19.4326,
  longitude: -99.1332,
  address: 'Test Address',
  description: null,
  properties: null,
  is_active: 1,
  site_id: null,
  site_name: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

const sampleDevice = {
  id: 1,
  name: 'Test Router',
  type: 'router',
  role: 'edge',
  status: 'active',
  ip_address: '10.0.0.1',
  latitude: 19.4326,
  longitude: -99.1332,
  site_id: null,
  site_name: null,
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') &&
        !sql.includes('map_geofences') &&
        !sql.includes('map_infrastructure_points') &&
        !sql.includes('device_dependency_edges') &&
        !sql.includes('network_links') &&
        !sql.includes('devices') &&
        !sql.includes('coverage_zones') &&
        !sql.includes('fiber_routes') &&
        !sql.includes('clients') &&
        !sql.includes('sites')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'topology.view' }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // Geofence queries
    if (typeof sql === 'string' && sql.includes('map_geofences')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[sampleGeofence]]);
    }
    // Infrastructure queries
    if (typeof sql === 'string' && sql.includes('map_infrastructure_points')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[sampleInfrastructure]]);
    }
    // Dependency edge queries
    if (typeof sql === 'string' && sql.includes('device_dependency_edges')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('DELETE')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 1, parent_device_id: 1, child_device_id: 2 }]]);
    }
    // Devices query
    if (typeof sql === 'string' && sql.includes('FROM devices')) {
      return Promise.resolve([[sampleDevice]]);
    }
    // network_links query
    if (typeof sql === 'string' && sql.includes('network_links')) {
      return Promise.resolve([[]]);
    }
    // snmp_metrics
    if (typeof sql === 'string' && sql.includes('snmp_metrics')) {
      return Promise.resolve([[]]);
    }
    // clients
    if (typeof sql === 'string' && sql.includes('FROM clients')) {
      return Promise.resolve([[]]);
    }
    // service_areas / coverage_zones
    if (typeof sql === 'string' && (sql.includes('service_areas') || sql.includes('coverage_zones'))) {
      return Promise.resolve([[]]);
    }
    // fiber_routes / fiber_route_segments
    if (typeof sql === 'string' && (sql.includes('fiber_routes') || sql.includes('fiber_route_segments'))) {
      return Promise.resolve([[]]);
    }
    // sites query
    if (typeof sql === 'string' && sql.includes('FROM sites')) {
      return Promise.resolve([[]]);
    }
    // Default
    return Promise.resolve([[sampleDevice]]);
  });
}

// ---------------------------------------------------------------------------
// Tests — Map data layers
// ---------------------------------------------------------------------------

describe('GET /api/v1/topology/map/network', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with nodes and edges', async () => {
    const res = await request(app)
      .get('/api/v1/topology/map/network')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/topology/map/fabric', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with nodes (tier + metrics), edges and incidents', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('WHERE id = ?') && !s.includes('devices') && !s.includes('sites')
          && !s.includes('snmp_metrics') && !s.includes('contracts') && !s.includes('outages')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('permissions') || s.includes('role_permissions')) {
        return Promise.resolve([[{ id: 1, name: 'topology.view' }]]);
      }
      // getNetworkGraph nodes
      if (s.includes('FROM devices d') && s.includes('LEFT JOIN sites')) {
        return Promise.resolve([[{ id: 5, name: 'core-1', type: 'router', role: 'core', status: 'online', site_id: 2, site_name: 'PoP-A' }]]);
      }
      if (s.includes('network_links')) return Promise.resolve([[]]);
      // firmware lookup
      if (s.includes('SELECT id, firmware FROM devices')) return Promise.resolve([[{ id: 5, firmware: '7.1.4' }]]);
      // latest metrics
      if (s.includes('FROM snmp_metrics')) return Promise.resolve([[{ device_id: 5, cpu_usage: 12, memory_usage: 40, uptime_ticks: 8640000, temperature_c: 35, sfp_rx_power_dbm: -18 }]]);
      // per-site clients
      if (s.includes('FROM contracts')) return Promise.resolve([[{ site_id: 2, clients: 300 }]]);
      // incidents
      if (s.includes('FROM outages')) return Promise.resolve([[{ id: 9, device_id: 5, site_id: 2, title: 'Outage', detail: 'down', severity: 'critical', started_at: '2026-07-17T05:00:00Z' }]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/topology/map/fabric')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(Array.isArray(d.nodes)).toBe(true);
    expect(Array.isArray(d.edges)).toBe(true);
    expect(Array.isArray(d.incidents)).toBe(true);
    expect(d.nodes[0]).toMatchObject({ id: 5, tier: 0 });
    expect(d.nodes[0].metrics).toMatchObject({ firmware: '7.1.4', clients: 300, cpu_usage: 12 });
    expect(d.incidents[0]).toMatchObject({ id: 9, severity: 'critical' });
  });
});

describe('GET /api/v1/topology/map/customers', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with customer locations', async () => {
    const res = await request(app)
      .get('/api/v1/topology/map/customers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/topology/map/coverage', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with coverage data', async () => {
    const res = await request(app)
      .get('/api/v1/topology/map/coverage')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/topology/map/impact/:deviceId', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with impact analysis for device 1', async () => {
    const res = await request(app)
      .get('/api/v1/topology/map/impact/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('device');
    expect(res.body.data).toHaveProperty('impacted');
  });
});

describe('GET /api/v1/topology/map/dual-homed', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with dual-homed devices', async () => {
    const res = await request(app)
      .get('/api/v1/topology/map/dual-homed')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// ---------------------------------------------------------------------------
// Tests — Geofences
// ---------------------------------------------------------------------------

describe('GET /api/v1/topology/geofences', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with list of geofences', async () => {
    const res = await request(app)
      .get('/api/v1/topology/geofences')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/topology/geofences', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates a geofence and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/topology/geofences')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Zone A', type: 'radius', center_lat: 19.4326, center_lng: -99.1332, radius_meters: 200 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });
});

describe('PUT /api/v1/topology/geofences/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('updates a geofence and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/topology/geofences/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Zone A Updated' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('DELETE /api/v1/topology/geofences/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('deletes a geofence and returns 204', async () => {
    const res = await request(app)
      .delete('/api/v1/topology/geofences/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Tests — Infrastructure
// ---------------------------------------------------------------------------

describe('GET /api/v1/topology/infrastructure', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with list of infrastructure points', async () => {
    const res = await request(app)
      .get('/api/v1/topology/infrastructure')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/topology/infrastructure', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates an infrastructure point and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/topology/infrastructure')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Tower 1', type: 'tower', latitude: 19.4326, longitude: -99.1332 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });
});
