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

// THE ATTACKER IS AN ADMIN, and that is the whole point.
//
// A first version of this suite built the attacker as {role:'billing'} with
// settings.update mocked in — a combination migration 119 never produces —
// so it went green against a gate that was still wide open. `roles` is a
// GLOBAL table and User.resolveGroupMirror copies group.kind into users.role,
// so EVERY tenant's admin has users.role='admin'. A test that does not use
// that exact shape does not test this hole.
const TENANT_ADMIN = { id: 2, email: 'admin@tenant2.mx', role: 'admin', status: 'active', organization_id: 2 };
// The install operator differs from a tenant admin only by something a tenant
// cannot forge — being alone on the install, or being named in the env.
const OPERATOR = { id: 1, email: 'op@isp.mx', role: 'admin', status: 'active', organization_id: 1 };
// A non-admin who holds settings.view but NOT settings.update.
const VIEWER = { id: 3, email: 'readonly@tenant2.mx', role: 'readonly', status: 'active', organization_id: 2 };

const tokenFor = (u) => jwt.sign(
  { sub: u.id, email: u.email, role: u.role, orgId: u.organization_id },
  config.jwt.secret,
  { expiresIn: '1h' },
);

/**
 * @param orgCount active organisations on the install — the signal that
 *   decides whether a legacy admin counts as the install operator. Default 2
 *   (multi-tenant), because that is the case the gate exists for.
 */
function wireDb({ user = OPERATOR, orgRows = [], installRows = [], orgCount = 2 } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[user]];
    if (/COUNT\(\*\) AS total FROM organizations/.test(sql)) return [[{ total: orgCount }]];
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
  // Non-admin callers resolve permissions through User.getPermissions. Legacy
  // admins bypass it entirely (rbac.js), so this only shapes VIEWER.
  jest.spyOn(User, 'getPermissions').mockResolvedValue(['settings.view']);
});

describe('GET /settings — one list, two scopes, per-caller editability', () => {
  it('returns org entries (defaults filled in) plus install entries', async () => {
    wireDb({
      user: TENANT_ADMIN,
      orgRows: [{ setting_key: 'mab_password_mode', setting_value: 'cleartext' }],
      installRows: INSTALL_ROWS,
    });
    const res = await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
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
    // orgCount 1: a single-organisation install, where the legacy admin
    // genuinely is the operator.
    wireDb({ user: OPERATOR, orgCount: 1, installRows: INSTALL_ROWS });
    const res = await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).toBe(200);
    const install = res.body.data.filter((e) => e.scope === 'install');
    expect(install.length).toBe(3);
    expect(install.every((e) => e.editable)).toBe(true);
  });

  it('reads org values scoped to the CALLER\'s org', async () => {
    wireDb({ user: TENANT_ADMIN, installRows: INSTALL_ROWS });
    await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    const orgRead = db.query.mock.calls.find(([sql]) => /FROM organization_settings/.test(sql));
    expect(orgRead).toBeDefined();
    expect(orgRead[1]).toEqual([TENANT_ADMIN.organization_id]);
  });
});

describe('PUT /settings/:key — org keys', () => {
  it('upserts an allowlisted key into organization_settings for the caller\'s org', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .put('/api/v1/settings/mab_password_mode')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ value: 'cleartext' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'mab_password_mode', value: 'cleartext', scope: 'org' });

    const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO organization_settings'));
    expect(upsert).toBeDefined();
    expect(upsert[1]).toEqual([TENANT_ADMIN.organization_id, 'mab_password_mode', 'cleartext']);
    // And it must never touch the install table.
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO settings'))).toBe(false);
  });

  it('422s an enum value outside the catalog', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .put('/api/v1/settings/mab_password_mode')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ value: 'plaintext-please' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_SETTING_VALUE');
  });

  it('422s a non-positive-integer threshold', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .put('/api/v1/settings/pppoe_auth_failure_threshold')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ value: '0' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_SETTING_VALUE');
  });
});

describe('PUT /settings/:key — install keys are operator-only (THE j56 hole)', () => {
  it('403s a TENANT ADMIN on a multi-organisation install — the real attacker', async () => {
    // users.role='admin' is the per-tenant Admin persona, so this caller looks
    // identical to the operator at the role level. Only the install shape
    // (more than one active org, no allowlist) tells them apart.
    wireDb({ user: TENANT_ADMIN, orgCount: 2 });
    const res = await request(app)
      .put('/api/v1/settings/ops_alert_email')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ value: 'attacker@evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTALL_SETTING_OPERATOR_ONLY');
    // Nothing may have been written.
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT') || sql.startsWith('UPDATE'))).toBe(false);
  });

  it('lets the admin of a SINGLE-organisation install write — there they are the operator', async () => {
    wireDb({ user: OPERATOR, orgCount: 1 });
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

  it('lets an INSTALL_OPERATOR_EMAILS account write on a multi-org install', async () => {
    jest.replaceProperty(config, 'installOperatorEmails', ['op@isp.mx']);
    wireDb({ user: OPERATOR, orgCount: 5 });
    const res = await request(app)
      .put('/api/v1/settings/map_tile_url')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: 'https://tiles.isp.mx/{z}/{x}/{y}.png' });
    expect(res.status).toBe(200);
  });

  it('still 403s a tenant admin who is NOT on the allowlist', async () => {
    jest.replaceProperty(config, 'installOperatorEmails', ['op@isp.mx']);
    wireDb({ user: TENANT_ADMIN, orgCount: 5 });
    const res = await request(app)
      .put('/api/v1/settings/map_tile_url')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ value: 'https://evil.example/{z}/{x}/{y}.png' });
    expect(res.status).toBe(403);
  });

  it('accepts a BLANK value — clearing an install key restores its documented default', async () => {
    // Blank map_tile_url means "use OpenStreetMap"; blank ops_alert_email means
    // "notify every org admin". Both are supported states, so `required` must
    // not reject them.
    wireDb({ user: OPERATOR, orgCount: 1 });
    const res = await request(app)
      .put('/api/v1/settings/map_tile_url')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: '' });
    expect(res.status).toBe(200);
    const write = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO settings'));
    expect(write[1]).toEqual(['map_tile_url', '']);
  });
});

describe('PUT /settings/:key — rejected keys and values', () => {
  it('422s an unknown key instead of upserting a dead row (the pre-443 failure mode)', async () => {
    wireDb({ user: OPERATOR, orgCount: 1 });
    const res = await request(app)
      .put('/api/v1/settings/smtp_host')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: 'smtp.example' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNKNOWN_SETTING');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });

  it('422s a prototype-named key rather than 500ing on it', async () => {
    // ORG_SETTING_DEFS['constructor'] is truthy on any plain object, so a bare
    // lookup would call def.validate and throw.
    wireDb({ user: OPERATOR, orgCount: 1 });
    for (const key of ['constructor', 'toString', '__proto__']) {
      const res = await request(app)
        .put(`/api/v1/settings/${encodeURIComponent(key)}`)
        .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
        .send({ value: 'x' });
      expect(res.status).toBe(422);
    }
  });

  it('422s a MISSING value even though blank is allowed', async () => {
    wireDb({ user: OPERATOR, orgCount: 1 });
    const res = await request(app)
      .put('/api/v1/settings/map_tile_url')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({});
    expect(res.status).toBe(422);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO settings'))).toBe(false);
  });
});

describe('editable reflects the caller\'s real permissions', () => {
  it('marks org rows NOT editable for a viewer who lacks settings.update', async () => {
    // This route needs only settings.view, so a readonly user reaches it.
    // Hardcoding editable:true would hand them an Edit button that 403s.
    wireDb({ user: VIEWER, orgCount: 1, installRows: INSTALL_ROWS });
    const res = await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${tokenFor(VIEWER)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.editable === false)).toBe(true);
  });
});
