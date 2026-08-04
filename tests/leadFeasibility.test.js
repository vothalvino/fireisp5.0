'use strict';
// =============================================================================
// FireISP 5.0 — GET /leads/:id/feasibility (desk check)
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const TOKEN = jwt.sign(
  { sub: 1, email: 'a@b.c', role: 'admin', orgId: 42 },
  config.jwt.secret, { expiresIn: '1h' },
);

const isAuthLookup = (s) => typeof s === 'string' && /`users`/.test(s);
const isLeadSelect = (s) => typeof s === 'string' && /FROM `?leads`?/.test(s);
const isZones      = (s) => typeof s === 'string' && /ST_Contains/.test(s);
const isWireless   = (s) => typeof s === 'string' && /ap_sector_configs/.test(s);
const isFtth       = (s) => typeof s === 'string' && /odf_frames/.test(s);

const ADMIN_ROW = [[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 42 }]];

beforeEach(() => jest.clearAllMocks());

it('reports has_coordinates=false for an ungeocoded lead and runs no spatial queries', async () => {
  db.query.mockImplementation(async (sql) => {
    if (isAuthLookup(sql)) return ADMIN_ROW;
    if (isLeadSelect(sql)) return [[{ id: 5, organization_id: 42, latitude: null, longitude: null }]];
    return [[]];
  });
  const res = await request(app)
    .get('/api/v1/leads/5/feasibility')
    .set('Authorization', `Bearer ${TOKEN}`);
  expect(res.status).toBe(200);
  expect(res.body.data.has_coordinates).toBe(false);
  expect(db.query.mock.calls.some(([s]) => isZones(s) || isWireless(s) || isFtth(s))).toBe(false);
});

it('returns zones, nearest APs and nearest ODF frames for a geocoded lead — org-scoped', async () => {
  db.query.mockImplementation(async (sql) => {
    if (isAuthLookup(sql)) return ADMIN_ROW;
    if (isLeadSelect(sql)) return [[{ id: 5, organization_id: 42, latitude: '19.4326000', longitude: '-99.1332000' }]];
    if (isZones(sql)) return [[{ id: 3, name: 'CDMX Sur', zone_type: 'fixed_wireless', status: 'active', max_download_mbps: 50, max_upload_mbps: 10 }]];
    if (isWireless(sql)) return [[{ device_id: 9, ap_name: 'North AP', distance_km: 2.4, frequency_mhz: 5800, sector_azimuth_deg: 120, signal_min_dbm: -65, link_capacity_min_mbps: 20 }]];
    if (isFtth(sql)) return [[{ id: 2, name: 'ODF-CO1-R01', site_name: 'CO1', distance_km: 1.1, port_count: 12, ports_tracked: 12, free_ports: 4 }]];
    return [[]];
  });
  const res = await request(app)
    .get('/api/v1/leads/5/feasibility')
    .set('Authorization', `Bearer ${TOKEN}`);
  expect(res.status).toBe(200);
  const d = res.body.data;
  expect(d.has_coordinates).toBe(true);
  expect(d.coverage_zones[0].name).toBe('CDMX Sur');
  expect(d.wireless[0].ap_name).toBe('North AP');
  expect(d.ftth[0].free_ports).toBe(4);

  // Every spatial/distance query carries the caller's org filter.
  const zoneCall = db.query.mock.calls.find(([s]) => isZones(s));
  expect(zoneCall[0]).toMatch(/organization_id = \?/);
  expect(zoneCall[1]).toContain(42);
  const apCall = db.query.mock.calls.find(([s]) => isWireless(s));
  expect(apCall[0]).toMatch(/d\.organization_id = \?/);
  const ftthCall = db.query.mock.calls.find(([s]) => isFtth(s));
  expect(ftthCall[0]).toMatch(/f\.organization_id = \?/);
});

it('404s a lead outside the caller org', async () => {
  db.query.mockImplementation(async (sql) => {
    if (isAuthLookup(sql)) return ADMIN_ROW;
    if (isLeadSelect(sql)) return [[]];
    return [[]];
  });
  const res = await request(app)
    .get('/api/v1/leads/999/feasibility')
    .set('Authorization', `Bearer ${TOKEN}`);
  expect(res.status).toBe(404);
});
