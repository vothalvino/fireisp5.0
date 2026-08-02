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
const TENANT_ADMIN = { id: 2, email: 'admin@tenant2.mx', role: 'admin', status: 'active', organization_id: 2, is_install_operator: 0 };
// The install operator differs from a tenant admin only by a STORED fact no
// request can set: users.is_install_operator (migration 444), or an id listed
// in INSTALL_OPERATOR_USER_IDS. An earlier design inferred it from the number
// of organisations; that broke both ways, so the tests below pin that
// organisation churn cannot move it.
const OPERATOR = { id: 1, email: 'op@isp.mx', role: 'admin', status: 'active', organization_id: 1, is_install_operator: 1 };
// A non-admin who holds settings.view but NOT settings.update.
const VIEWER = { id: 3, email: 'readonly@tenant2.mx', role: 'readonly', status: 'active', organization_id: 2 };

const tokenFor = (u) => jwt.sign(
  { sub: u.id, email: u.email, role: u.role, orgId: u.organization_id },
  config.jwt.secret,
  { expiresIn: '1h' },
);

/**
 * @param orgCount how many organisation rows the install has. It must NOT
 *   affect operator status — the tests below assert exactly that, because a
 *   previous design derived the gate from this number and broke when ordinary
 *   onboarding changed it.
 */
function wireDb({ user = OPERATOR, orgRows = [], installRows = [], orgCount = 2 } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[user]];
    if (/COUNT\(\*\).*FROM organizations/.test(sql)) return [[{ total: orgCount }]];
    if (/SELECT is_install_operator FROM users/.test(sql)) {
      return [[{ is_install_operator: user.is_install_operator ?? 0 }]];
    }
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

  it('lets the flagged operator write', async () => {
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
    jest.replaceProperty(config, 'installOperatorUserIds', [OPERATOR.id]);
    wireDb({ user: { ...OPERATOR, is_install_operator: 0 }, orgCount: 5 });
    const res = await request(app)
      .put('/api/v1/settings/map_tile_url')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: 'https://tiles.isp.mx/{z}/{x}/{y}.png' });
    expect(res.status).toBe(200);
  });

  it('still 403s a tenant admin who is NOT on the allowlist', async () => {
    jest.replaceProperty(config, 'installOperatorUserIds', [OPERATOR.id]);
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

// ---------------------------------------------------------------------------
// Organisation delete/restore — the gate's own foundation
// ---------------------------------------------------------------------------
// Organization.hasOrgScope is false, so BaseModel omits the tenant predicate
// entirely (the j36 trap, here on the organizations table itself) and these two
// verbs had NO ownership guard at all: any tenant admin could soft-delete or
// resurrect another tenant's organisation by id, with GET / listing the ids.
// It is destructive on its own AND it undermined the operator gate, which
// counts organisations — deleting the neighbours would have bought operator
// status back. (The count now spans all rows, so both halves are closed.)

describe('DELETE/POST /organizations/:id — cross-tenant destruction', () => {
  it('403s a tenant admin deleting ANOTHER org', async () => {
    wireDb({ user: TENANT_ADMIN, orgCount: 5 });
    const res = await request(app)
      .delete('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(403);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE organizations|DELETE FROM organizations/i.test(sql))).toBe(false);
  });

  it('403s a tenant admin restoring ANOTHER org', async () => {
    wireDb({ user: TENANT_ADMIN, orgCount: 5 });
    const res = await request(app)
      .post('/api/v1/organizations/1/restore')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(403);
  });

  it('403s a tenant admin deleting even their OWN org — decommissioning is the operator\'s act', async () => {
    // Product decision 2026-08-02: own-org delete went with the rest. An org
    // holds stamped CFDIs whose retention outlives any tenant's wish to leave.
    wireDb({ user: TENANT_ADMIN, orgCount: 5 });
    const res = await request(app)
      .delete(`/api/v1/organizations/${TENANT_ADMIN.organization_id}`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(403);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE organizations|DELETE FROM organizations/i.test(sql))).toBe(false);
  });

  it('lets the INSTALL OPERATOR delete an organisation', async () => {
    wireDb({ user: OPERATOR, orgCount: 5 });
    const res = await request(app)
      .delete('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).not.toBe(403);
  });
});

describe('organisation churn cannot move operator status', () => {
  // A previous design read the gate off a COUNT of organisations. It broke in
  // both directions: counting live rows let a tenant admin delete the
  // neighbours to promote themselves; counting every row meant the ordinary
  // onboarding move (create your real org, delete the seeded demo one) left a
  // soft-deleted row behind and permanently took the update button away from
  // the box owner. The stored flag is immune to both, and these cases say so.
  it.each([[1], [2], [7]])('the flagged operator still writes with %i organisations', async (orgCount) => {
    wireDb({ user: OPERATOR, orgCount });
    const res = await request(app)
      .put('/api/v1/settings/ops_alert_email')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: 'noc@isp.mx' });
    expect(res.status).toBe(200);
  });

  it.each([[1], [2], [7]])('an unflagged tenant admin never writes, at %i organisations', async (orgCount) => {
    wireDb({ user: TENANT_ADMIN, orgCount });
    const res = await request(app)
      .put('/api/v1/settings/ops_alert_email')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ value: 'attacker@evil.example' });
    expect(res.status).toBe(403);
  });

  it('never asks how many organisations there are', async () => {
    wireDb({ user: OPERATOR, orgCount: 1 });
    await request(app)
      .put('/api/v1/settings/ops_alert_email')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ value: 'noc@isp.mx' });
    expect(db.query.mock.calls.some(([sql]) => /COUNT\(\*\).*FROM organizations/.test(sql))).toBe(false);
  });
});

describe('is_install_operator on GET /auth/me', () => {
  it('tells the frontend who runs the install, so UI is not gated on users.role', async () => {
    wireDb({ user: OPERATOR, orgCount: 1 });
    jest.spyOn(User, 'findById').mockResolvedValue(OPERATOR);
    jest.spyOn(User, 'getOrganizations').mockResolvedValue([{ id: 1, name: 'Home' }]);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_install_operator).toBe(true);
  });

  it('is false for a tenant admin on a multi-organisation install', async () => {
    wireDb({ user: TENANT_ADMIN, orgCount: 4 });
    jest.spyOn(User, 'findById').mockResolvedValue(TENANT_ADMIN);
    jest.spyOn(User, 'getOrganizations').mockResolvedValue([{ id: 2, name: 'Tenant 2' }]);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_install_operator).toBe(false);
  });

  it('degrades to false instead of 500ing when the count cannot be read', async () => {
    // /auth/me is the session bootstrap. A hint about which controls to render
    // must never be able to lock everyone out of the app.
    db.query.mockImplementation(async (sql) => {
      if (isUserLookup(sql)) return [[OPERATOR]];
      // ONLY the operator lookup fails — a throw elsewhere is a genuine 500.
      if (/SELECT is_install_operator FROM users/.test(sql)) throw new Error('lookup failed');
      return [[]];
    });
    jest.spyOn(User, 'findById').mockResolvedValue(OPERATOR);
    jest.spyOn(User, 'getOrganizations').mockResolvedValue([]);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_install_operator).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API tokens on /system/* — the scope enforcement that never ran
// ---------------------------------------------------------------------------
// enforceTokenScopes only runs inside requirePermission()/userHasPermission().
// The /system routes use neither, so a token deliberately narrowed to (say)
// clients.view still presented its owner's role and could queue a host
// redeploy — the most privileged action in the product. The host agent talks
// to MySQL directly and holds no token, so refusing token callers outright
// costs nothing legitimate.

describe('/system/* refuses API tokens outright', () => {
  const TOKEN_ROW = {
    id: 900, user_id: OPERATOR.id, email: OPERATOR.email, role: 'admin',
    status: 'active', organization_id: 1, scopes: '["clients.view"]',
  };

  function wireToken() {
    db.query.mockImplementation(async (sql) => {
      if (/FROM api_tokens/.test(sql)) return [[TOKEN_ROW]];
      if (/SELECT is_install_operator FROM users/.test(sql)) return [[{ is_install_operator: 1 }]];
      return [[{ affectedRows: 1 }]];
    });
  }

  it('404s a narrowed token on the deploy trigger, even one owned by the operator', async () => {
    wireToken();
    const res = await request(app).post('/api/v1/system/deploy').set('X-API-Key', 'k').send({});
    expect(res.status).toBe(404);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO deploy_requests/.test(sql))).toBe(false);
  });

  it('404s it on the version read too', async () => {
    wireToken();
    const res = await request(app).get('/api/v1/system/version').set('X-API-Key', 'k');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The rest of the /organizations/:id surface (same guard, same reason)
// ---------------------------------------------------------------------------
// These sub-routes had NO ownership check at all: :id was attacker-chosen and
// GET / lists the ids. email-settings is the sharp one — it carries the org's
// outbound mail identity and credentials state.

describe('per-org config sub-routes are ownership-guarded', () => {
  const OTHER_ORG = 1; // TENANT_ADMIN lives in org 2

  it.each([
    ['get', `/api/v1/organizations/${OTHER_ORG}/quota`],
    ['get', `/api/v1/organizations/${OTHER_ORG}/email-settings`],
    ['get', `/api/v1/organizations/${OTHER_ORG}/database-isolation`],
    ['get', `/api/v1/organizations/${OTHER_ORG}/settings`],
  ])('403s a tenant admin reading another org (%s %s)', async (method, path) => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)[method](path).set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(403);
  });

  it('403s a tenant admin rewriting another org\'s quota', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .put(`/api/v1/organizations/${OTHER_ORG}/quota`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ max_clients: 999999 });
    expect(res.status).toBe(403);
  });

  it('403s a tenant admin rewriting another org\'s name', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .patch(`/api/v1/organizations/${OTHER_ORG}`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ name: 'Owned' });
    expect(res.status).toBe(403);
  });

  it('lets the caller reach their OWN org', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .get(`/api/v1/organizations/${TENANT_ADMIN.organization_id}/settings`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(200);
  });

  it('lets the install operator reach any org', async () => {
    wireDb({ user: OPERATOR });
    const res = await request(app)
      .get('/api/v1/organizations/7/settings')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /organizations is scoped to memberships (j67)
// ---------------------------------------------------------------------------
// Organization.hasOrgScope is false, so the generic list returned EVERY ISP on
// the box to anyone with organizations.view — which migration 119 grants every
// org admin. Under real isolation that is enumeration of the neighbours, and it
// hands over the very ids every other guard is keyed on.

describe('GET /organizations scoping', () => {
  it('returns only the caller\'s memberships for a tenant admin', async () => {
    db.query.mockImplementation(async (sql) => {
      if (isUserLookup(sql)) return [[TENANT_ADMIN]];
      if (/SELECT is_install_operator FROM users/.test(sql)) return [[{ is_install_operator: 0 }]];
      if (/JOIN organization_users/.test(sql) && /COUNT/.test(sql)) return [[{ total: 1 }]];
      if (/JOIN organization_users/.test(sql)) return [[{ id: 2, name: 'Tenant A' }]];
      return [[]];
    });
    const res = await request(app).get('/api/v1/organizations').set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 2, name: 'Tenant A' }]);
    // The membership join is keyed on the CALLER, and the unscoped list never runs.
    const listQuery = db.query.mock.calls.find(([sql]) => /JOIN organization_users/.test(sql));
    expect(listQuery[1]).toEqual([TENANT_ADMIN.id]);
  });

  it('returns every organisation for the install operator', async () => {
    db.query.mockImplementation(async (sql) => {
      if (isUserLookup(sql)) return [[OPERATOR]];
      if (/SELECT is_install_operator FROM users/.test(sql)) return [[{ is_install_operator: 1 }]];
      if (/COUNT/.test(sql)) return [[{ total: 3 }]];
      return [[{ id: 1 }, { id: 2 }, { id: 3 }]];
    });
    const res = await request(app).get('/api/v1/organizations').set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    // The operator takes the generic list, not the membership join.
    expect(db.query.mock.calls.some(([sql]) => /JOIN organization_users/.test(sql))).toBe(false);
  });
});

describe('fiscal identity is editable only from inside the org (j66)', () => {
  it('403s the install operator acting on another org from outside it', async () => {
    // The user chose strict: switch into the org first, so the act is
    // attributable to that org rather than to a god-mode caller.
    wireDb({ user: OPERATOR });
    const res = await request(app)
      .get('/api/v1/organizations/9/mx-profile')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).toBe(403);
  });

  it('403s a tenant admin reaching another org\'s fiscal identity', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .put('/api/v1/organizations/1/mx-profile')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ rfc: 'XAXX010101000', razon_social: 'Owned', regimen_fiscal: '601', codigo_postal_fiscal: '06600' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Constraints imposed ON a tenant are not the tenant's to change
// ---------------------------------------------------------------------------
// Owning the organisation is not enough for these: a tenant that can raise its
// own quota has no quota, database isolation is deployment infrastructure, and
// an organisation the operator suspended must not resurrect itself.

describe('operator-only surfaces reject even the org that owns them', () => {
  const own = TENANT_ADMIN.organization_id;

  it('403s a tenant admin raising their OWN quota', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .put(`/api/v1/organizations/${own}/quota`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({ max_clients: 999999 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTALL_OPERATOR_ONLY');
  });

  it('still lets them READ their own quota — they should see their limits', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .get(`/api/v1/organizations/${own}/quota`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).not.toBe(403);
  });

  it('403s a tenant admin reading their own database isolation config', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .get(`/api/v1/organizations/${own}/database-isolation`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(403);
  });

  it('403s a tenant admin restoring their own soft-deleted organisation', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .post(`/api/v1/organizations/${own}/restore`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`);
    expect(res.status).toBe(403);
  });

  it('lets the install operator do all of it', async () => {
    wireDb({ user: OPERATOR });
    const res = await request(app)
      .put('/api/v1/organizations/9/quota')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`)
      .send({ max_clients: 500 });
    expect(res.status).not.toBe(403);
  });
});

describe('organization_ids cannot mint membership in someone else\'s org', () => {
  // Manufactured membership defeats every boundary that trusts
  // organization_users — switch-organization above all.
  it('403s a tenant admin granting a user access to another org', async () => {
    wireDb({ user: TENANT_ADMIN });
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokenFor(TENANT_ADMIN)}`)
      .send({
        first_name: 'Walk', last_name: 'In', email: 'walkin@tenant2.mx',
        password: 'Sup3rSecret!23', role: 'admin',
        organization_ids: [1, TENANT_ADMIN.organization_id],
      });
    expect(res.status).toBe(403);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO organization_users/.test(sql))).toBe(false);
  });
});

describe('the operator ACCOUNT cannot be taken over', () => {
  // The flag is un-writable, but the row that carries it was not: every field
  // restrictRoleAssignment guards is a takeover primitive (set a password, or
  // repoint the email and use the reset flow), and its own gate was
  // `role === 'admin'` — the per-tenant persona. A co-org admin could log in
  // AS the operator and reach the deploy trigger.
  function wireUsers(actor, target) {
    db.query.mockImplementation(async (sql) => {
      if (isUserLookup(sql)) return [[actor]];
      if (/SELECT is_install_operator FROM users/.test(sql)) {
        return [[{ is_install_operator: actor.is_install_operator ?? 0 }]];
      }
      return [[{ affectedRows: 1 }]];
    });
    jest.spyOn(User, 'findById').mockImplementation(async (id) => (
      Number(id) === Number(target.id) ? target : actor
    ));
  }

  it('403s a co-org admin resetting the operator\'s password', async () => {
    wireUsers({ ...TENANT_ADMIN, organization_id: 1 }, { ...OPERATOR, is_install_operator: 1 });
    const res = await request(app)
      .put(`/api/v1/users/${OPERATOR.id}`)
      .set('Authorization', `Bearer ${tokenFor({ ...TENANT_ADMIN, organization_id: 1 })}`)
      .send({ password: 'AttackerPass123!' });
    expect(res.status).toBe(403);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE `?users`?/i.test(sql))).toBe(false);
  });

  it('403s repointing the operator\'s email', async () => {
    wireUsers({ ...TENANT_ADMIN, organization_id: 1 }, { ...OPERATOR, is_install_operator: 1 });
    const res = await request(app)
      .put(`/api/v1/users/${OPERATOR.id}`)
      .set('Authorization', `Bearer ${tokenFor({ ...TENANT_ADMIN, organization_id: 1 })}`)
      .send({ email: 'attacker@evil.example' });
    expect(res.status).toBe(403);
  });

  it('lets the operator change their OWN credentials', async () => {
    const op = { ...OPERATOR, is_install_operator: 1 };
    wireUsers(op, op);
    const res = await request(app)
      .put(`/api/v1/users/${OPERATOR.id}`)
      .set('Authorization', `Bearer ${tokenFor(op)}`)
      .send({ password: 'MyOwnNewPass123!' });
    expect(res.status).not.toBe(403);
  });

  it('leaves ordinary staff edits alone', async () => {
    const actor = { ...TENANT_ADMIN, organization_id: 1 };
    wireUsers(actor, { id: 55, role: 'billing', status: 'active', organization_id: 1, is_install_operator: 0 });
    const res = await request(app)
      .put('/api/v1/users/55')
      .set('Authorization', `Bearer ${tokenFor(actor)}`)
      .send({ password: 'RoutineReset123!' });
    expect(res.status).not.toBe(403);
  });
});
