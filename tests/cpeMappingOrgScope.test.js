'use strict';
// =============================================================================
// FireISP 5.0 — CPE parameter mappings are org-scoped (j58)
// =============================================================================
// Every handler in the mappings block was missing its tenancy check entirely:
//
//   CpeProfile.findByIdOrFail(req.params.id)          <- no orgId
//   SELECT * FROM cpe_parameter_mappings WHERE cpe_profile_id = ?   <- no org
//   CpeParameterMapping.update(req.params.mappingId, req.body)      <- no orgId
//   CpeParameterMapping.delete(req.params.mappingId)                <- no orgId
//
// BaseModel omits the org predicate SILENTLY when orgId is null, so the profile
// lookup that was supposed to AUTHORISE the handler passed for a foreign
// profile, and update/delete emitted `WHERE id = ?` alone. Any tenant could
// read, rewrite or destroy any other tenant's mappings by guessing an id.
//
// TR-069 parameter mappings decide what is provisioned onto a subscriber's CPE,
// so a cross-tenant write here is a configuration-integrity problem, not only a
// disclosure one.
//
// These assert on the EMITTED SQL, not just the status code: a 404 could come
// from an empty mock rather than from a predicate that is actually there, and
// that distinction is the entire fix.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(), off: jest.fn(), once: jest.fn(), removeListener: jest.fn(),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };
const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);

const PROFILE = { id: 1, organization_id: 1, name: 'p' };
const MAPPING = { id: 99, organization_id: 1, cpe_profile_id: 1, parameter_path: 'x' };

function wire({ profileVisible = true, mappingVisible = true } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[ADMIN]];
    if (/FROM `?cpe_profiles`?/i.test(sql)) return [profileVisible ? [PROFILE] : []];
    if (/SELECT id FROM cpe_parameter_mappings/.test(sql)) return [mappingVisible ? [{ id: 99 }] : []];
    if (/FROM cpe_parameter_mappings/i.test(sql)) return [mappingVisible ? [MAPPING] : []];
    if (/^UPDATE `?cpe_parameter_mappings`?/i.test(sql)) return [{ affectedRows: 1 }];
    if (/^DELETE FROM `?cpe_parameter_mappings`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const calls = (re) => db.query.mock.calls.filter(([s]) => re.test(s));
const BASE = '/api/v1/cpe-profiles/1/mappings';

beforeEach(() => { jest.clearAllMocks(); wire(); });

describe('the parent profile is checked against the org', () => {
  it.each([
    ['GET', BASE],
    ['POST', BASE],
    ['PUT', `${BASE}/99`],
    ['DELETE', `${BASE}/99`],
  ])('%s %s scopes the profile lookup', async (method, url) => {
    // This lookup is what AUTHORISES the whole handler. Unscoped, a foreign
    // profile passed it and everything downstream proceeded.
    const r = request(app)[method.toLowerCase()](url);
    await auth(r).send({ parameter_path: 'p', source_type: 'static', static_value: 'v' });
    const lookup = calls(/FROM `?cpe_profiles`?/i)[0];
    expect(lookup).toBeDefined();
    expect(lookup[0]).toMatch(/organization_id = \?/);
    expect(lookup[1]).toContain(1);
  });

  it('404s when the profile belongs to another tenant', async () => {
    wire({ profileVisible: false });
    const res = await auth(request(app).get(BASE));
    expect(res.status).toBe(404);
  });

  it('does not read mappings at all for a foreign profile', async () => {
    wire({ profileVisible: false });
    await auth(request(app).get(BASE));
    expect(calls(/FROM cpe_parameter_mappings/i)).toHaveLength(0);
  });
});

describe('the mapping queries carry their own org predicate', () => {
  it('the list is scoped', async () => {
    await auth(request(app).get(BASE));
    const list = calls(/SELECT \* FROM cpe_parameter_mappings/i)[0];
    expect(list[0]).toMatch(/organization_id = \?/);
  });

  it('UPDATE is scoped — this emitted `WHERE id = ?` alone before', async () => {
    await auth(request(app).put(`${BASE}/99`)).send({ parameter_path: 'edited' });
    const upd = calls(/^UPDATE `?cpe_parameter_mappings`?/i)[0];
    expect(upd).toBeDefined();
    expect(upd[0]).toMatch(/organization_id = \?/);
  });

  it('DELETE is scoped', async () => {
    await auth(request(app).delete(`${BASE}/99`));
    const del = calls(/(^DELETE FROM|^UPDATE) `?cpe_parameter_mappings`?/i)[0];
    expect(del).toBeDefined();
    expect(del[0]).toMatch(/organization_id = \?/);
  });
});

describe('a foreign or mismatched mapping is refused', () => {
  it('PUT 404s and writes nothing when the mapping is not visible', async () => {
    wire({ mappingVisible: false });
    const res = await auth(request(app).put(`${BASE}/99`)).send({ parameter_path: 'x' });
    expect(res.status).toBe(404);
    expect(calls(/^UPDATE `?cpe_parameter_mappings`?/i)).toHaveLength(0);
  });

  it('DELETE 404s and destroys nothing', async () => {
    wire({ mappingVisible: false });
    const res = await auth(request(app).delete(`${BASE}/99`));
    expect(res.status).toBe(404);
    expect(calls(/DELETE FROM `?cpe_parameter_mappings`?/i)).toHaveLength(0);
  });

  it('binds BOTH the profile and the org when proving ownership', async () => {
    // Also fixes a smaller correctness bug: a mapping belonging to a DIFFERENT
    // profile of the same org was editable through the wrong URL.
    await auth(request(app).put(`${BASE}/99`)).send({ parameter_path: 'x' });
    const probe = calls(/SELECT id FROM cpe_parameter_mappings/)[0];
    expect(probe[0]).toMatch(/cpe_profile_id = \?/);
    expect(probe[0]).toMatch(/organization_id = \?/);
  });
});

describe('single-tenant installs still work', () => {
  it('admits NULL-org rows when the caller has no org', () => {
    // organization_id on this table is nullable, so a single-tenant install
    // legitimately has NULL-org mappings. A bare `organization_id = ?` would
    // hide all of them — the #582 anti-fix.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/routes/cpeProfiles.js'), 'utf8',
    );
    expect(src).toMatch(/\? IS NULL AND organization_id IS NULL/);
  });
});
