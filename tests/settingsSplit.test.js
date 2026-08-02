'use strict';
// =============================================================================
// FireISP 5.0 — install vs org settings split (j56, migration 443)
// =============================================================================
// Before the split, GET/PUT /settings read and wrote the INSTALL-level
// `settings` table while pretending to be per-org: any tenant admin could
// rewrite ops_alert_email (where the install's infrastructure alerts go) or
// repoint every tenant's map tiles — proven live before the fix. These tests
// pin the new contract:
//
//   * org keys      → organization_settings, scoped to req.orgId, allowlisted
//                     and validated (no more arbitrary-key upserts)
//   * install keys  → `settings`, readable by all orgs, writable ONLY by the
//                     install operator (legacy users.role='admin')
//   * unknown keys  → 422, never a silent dead row
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');
const User = require('../src/models/User');

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');

// The install operator: legacy users.role='admin' (bypasses permission checks
// AND is the only writer of install keys).
const OPERATOR = { id: 1, email: 'op@isp.mx', role: 'admin', status: 'active', organization_id: 1 };
// An org-level user who HOLDS settings.view/update through their membership
// role but is NOT the install operator — the caller the old code let through.
const ORG_USER = { id: 2, email: 'billing@tenant2.mx', role: 'billing', status: 'active', organization_id: 2 };

const tokenFor = (u) => jwt.sign(
  { sub: u.id, email: u.email, role: u.role, orgId: u.organization_id },
  config.jwt.secret,
  { expiresIn: '1h' },
);

function wireDb({ user = OPERATOR, orgRows = [], installRows = [] } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[user]];
    if (/FROM organization_settings/.test(sql)) return [orgRows];
    if (/FROM settings/.test(sql)) return [installRows];
    return [[{ affectedRows: 1 }]];
  });
}

const INSTALL_ROWS = [
  { setting_key: 'map_tile_attribution', setting_value: '&copy; OSM', description: 'Attribution HTML' },
  { setting_key: 'map_tile_url', setting_value: 'https://tile.example/{z}/{x}/{y}.png', description: 'Tile URL' },
  { setting_key: 'ops_alert_email', setting_value: 'ops@isp.mx', description: 'Infra alerts' },
];

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  // Non-admin callers resolve permissions through User.getPermissions; give
  // the org user the slugs migration 119 grants their role.
  jest.spyOn(User, 'getPermissions').mockResolvedValue(['settings.view', 'settings.update']);
});

describe('GET /settings — one list, two scopes, per-caller editability', () => {
  it('returns org entries (defaults filled in) plus install entries', async () => {
    wireDb({
      user: ORG_USER,
      orgRows: [{ setting_key: 'mab_password_mode', setting_value: 'cleartext' }],
      installRows: INSTALL_ROWS,
    });
    const res = await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${tokenFor(ORG_USER)}`);
    expect(res.status).toBe(200);

    const byKey = Object.fromEntries(res.body.data.map((e) => [e.key, e]));
    // Org scope: the stored value wins, the never-set key falls back to its default.
    expect(byKey.mab_password_mode).toMatchObject({ value: 'cleartext', scope: 'org', editable: true });
    expect(byKey.pppoe_auth_failure_threshold).toMatchObject({ value: '5', scope: 'org', editable: true });
    // Install scope: visible, but NOT editable for an org user.
    expect(byKey.ops_alert_email).toMatchObject({ value: 'ops@isp.mx', scope: 'install', editable: false });
    expect(byKey.map_tile_url.editable).toBe(false);
  });

  it('marks install entries editable for the install operator', async () => {
    wireDb({ user: OPERATOR, installRows: INSTALL_ROWS });
    const res = await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).toBe(200);
    const install = res.body.data.filter((e) => e.scope === 'install');
    expect(install.length).toBe(3);
    expect(install.every((e) => e.editable)).toBe(true);
  });

  it('reads org values scoped to the CALLER\'s org', async () => {
    wireDb({ user: ORG_USER, installRows: INSTALL_ROWS });
    await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${tokenFor(ORG_USER)}`);
    const orgRead = db.query.mock.calls.find(([sql]) => /FROM organization_settings/.test(sql));
    expect(orgRead).toBeDefined();
    expect(orgRead[1]).toEqual([ORG_USER.organization_id]);
  });
});

describe('PUT /settings/:key — org keys', () => {
  it('upserts an allowlisted key into organization_settings for the caller\'s org', async () => {
    wireDb({ user: ORG_USER });
    const res = await request(app)
      .put('/api/v1/settings/mab_password_mode')
      .set('Authorization', `Bearer ${tokenFor(ORG_USER)}`)
      .send({ value: 'cleartext' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'mab_password_mode', value: 'cleartext', scope: 'org' });

    const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO organization_settings'));
    expect(upsert).toBeDefined();
    expect(upsert[1]).toEqual([ORG_USER.organization_id, 'mab_password_mode', 'cleartext']);
    // And it must never touch the install table.
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO settings'))).toBe(false);
  });

  it('422s an enum value outside the catalog', async () => {
    wireDb({ user: ORG_USER });
    const res = await request(app)
      .put('/api/v1/settings/mab_password_mode')
      .set('Authorization', `Bearer ${tokenFor(ORG_USER)}`)
      .send({ value: 'plaintext-please' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_SETTING_VALUE');
  });

  it('422s a non-positive-integer threshold', async () => {
    wireDb({ user: ORG_USER });
    const res = await request(app)
      .put('/api/v1/settings/pppoe_auth_failure_threshold')
      .set('Authorization', `Bearer ${tokenFor(ORG_USER)}`)
      .send({ value: '0' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_SETTING_VALUE');
  });
});

describe('PUT /settings/:key — install keys are operator-only (THE j56 hole)', () => {
  it('403s an org user who holds settings.update — the exact caller the old code let through', async () => {
    wireDb({ user: ORG_USER });
    const res = await request(app)
      .put('/api/v1/settings/ops_alert_email')
      .set('Authorization', `Bearer ${tokenFor(ORG_USER)}`)
      .send({ value: 'attacker@evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTALL_SETTING_OPERATOR_ONLY');
    // Nothing may have been written.
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT') || sql.startsWith('UPDATE'))).toBe(false);
  });

  it('lets the install operator update an install key in the settings table', async () => {
    wireDb({ user: OPERATOR });
    const res = await request(app)
      .put('/api/v1/settings/ops_alert_email')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: 'noc@isp.mx' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'ops_alert_email', scope: 'install' });
    const write = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO settings'));
    expect(write).toBeDefined();
    expect(write[1]).toEqual(['ops_alert_email', 'noc@isp.mx']);
  });
});

describe('PUT /settings/:key — unknown keys', () => {
  it('422s instead of upserting a dead row (the pre-443 failure mode)', async () => {
    wireDb({ user: OPERATOR });
    const res = await request(app)
      .put('/api/v1/settings/smtp_host')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: 'smtp.example' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNKNOWN_SETTING');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
});
