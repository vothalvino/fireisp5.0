'use strict';
// =============================================================================
// FireISP 5.0 — GET /map-config
// =============================================================================
// Every map hardcoded OpenStreetMap's public tile server. OSM is the right
// DEFAULT — no account, no API key, no signup, so a fresh install has working
// maps immediately — but not the only option: OSM's tile usage policy is aimed
// at modest use, and an ISP whose dispatchers pan a map all day should point at
// their own tile server or a commercial provider.
//
// The endpoint deliberately requires ONLY authentication. Reading this through
// /organizations/:id/settings would need `settings.view`, which migration 119
// grants to admin and billing only — and the technician map's primary audience
// is technicians, who would have been 403'd out of the very page they need.
// Nothing here is secret: a public tile URL and an attribution string.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');
const { DEFAULT_TILE_URL, DEFAULT_ATTRIBUTION } = require('../src/routes/mapConfig');

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
// A TECHNICIAN, on purpose: the role that lacks settings.view.
const TECH = { id: 9, email: 't@b.c', role: 'technician', status: 'active', organization_id: 1 };
const token = () => jwt.sign({ sub: 9, email: 't@b.c', role: 'technician', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });

function wireDb(settingRows = []) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[TECH]];
    if (/FROM settings/.test(sql)) return [settingRows];
    return [[]];
  });
}

const get = () => request(app).get('/api/v1/map-config').set('Authorization', `Bearer ${token()}`);

beforeEach(() => jest.clearAllMocks());

describe('a technician can read it — the whole point of a separate endpoint', () => {
  it('returns 200 for a role WITHOUT settings.view', async () => {
    wireDb();
    const res = await get();
    expect(res.status).toBe(200);
  });

  it('still requires authentication', async () => {
    wireDb();
    expect((await request(app).get('/api/v1/map-config')).status).toBe(401);
  });
});

describe('defaults keep maps working with zero setup', () => {
  it('falls back to OpenStreetMap when nothing is configured', async () => {
    wireDb([]);
    const { body } = await get();
    expect(body.data.tile_url).toBe(DEFAULT_TILE_URL);
    expect(body.data.attribution).toBe(DEFAULT_ATTRIBUTION);
    expect(body.data.is_default).toBe(true);
  });

  it('treats a BLANK setting as unset rather than as "no tiles"', async () => {
    // An admin who clears the field in the settings form must not end up with
    // every map a grey square.
    wireDb([
      { setting_key: 'map_tile_url', setting_value: '   ' },
      { setting_key: 'map_tile_attribution', setting_value: '' },
    ]);
    const { body } = await get();
    expect(body.data.tile_url).toBe(DEFAULT_TILE_URL);
    expect(body.data.attribution).toBe(DEFAULT_ATTRIBUTION);
  });
});

describe('a configured provider is served through', () => {
  it('returns the operator’s own tile server and marks it non-default', async () => {
    wireDb([
      { setting_key: 'map_tile_url', setting_value: 'https://tiles.myisp.mx/{z}/{x}/{y}.png' },
      { setting_key: 'map_tile_attribution', setting_value: '&copy; Mi ISP' },
    ]);
    const { body } = await get();
    expect(body.data.tile_url).toBe('https://tiles.myisp.mx/{z}/{x}/{y}.png');
    expect(body.data.attribution).toBe('&copy; Mi ISP');
    expect(body.data.is_default).toBe(false);
  });

  it('keeps the URL template placeholders intact', async () => {
    // {z}/{x}/{y} must survive verbatim — leaflet substitutes them, we must not.
    wireDb([{ setting_key: 'map_tile_url', setting_value: 'https://a.tiles.example/{z}/{x}/{y}@2x.png' }]);
    const { body } = await get();
    expect(body.data.tile_url).toContain('{z}');
    expect(body.data.tile_url).toContain('{x}');
    expect(body.data.tile_url).toContain('{y}');
  });

  it('reads only the two map keys, not the whole settings table', async () => {
    wireDb();
    await get();
    const q = db.query.mock.calls.find(c => /FROM settings/.test(c[0]));
    expect(q[0]).toMatch(/setting_key IN \('map_tile_url', 'map_tile_attribution'\)/);
  });
});
