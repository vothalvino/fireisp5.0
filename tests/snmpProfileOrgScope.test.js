'use strict';
// =============================================================================
// FireISP 5.0 — SNMP profiles are org-scoped, and the shipped ones are locked (j36)
// =============================================================================
// SnmpProfile declared hasOrgScope = false on a table with no organization_id,
// so every verb behind the generic crudController ran unscoped: any tenant
// could read, rewrite or DELETE another tenant's polling profiles. A profile
// decides which OIDs are polled from which devices, so a hostile or careless
// edit silently blinds another ISP's monitoring — the damage lands on the exact
// thing you would use to notice it.
//
// Migration 440 adds organization_id and is_system, and splits profiles in two:
//
//   SYSTEM  (is_system=1, org NULL) — the vendor library FireISP ships.
//           Visible to every tenant, editable by NONE. Not a permission: there
//           is no per-tenant answer to "may I retune what everyone else polls".
//   TENANT  (is_system=0) — owned by whoever created it, invisible to others.
//
// The subtle half is the OID sub-routes. They took req.params.id with no
// ownership check at all, so they walked straight around the immutability lock:
// you cannot edit "MikroTik RouterOS", but you could gut it by deleting its
// OIDs one at a time.
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

const MINE = { id: 10, organization_id: 1, is_system: 0, name: 'My Profile' };
const SYSTEM = { id: 2, organization_id: null, is_system: 1, name: 'MikroTik RouterOS' };
const LEGACY = { id: 11, organization_id: null, is_system: 0, name: 'Old custom' };

function wire({ rows = [MINE], isSystem = 0, visible = true } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: rows.length }]];
    if (/SELECT is_system FROM snmp_profiles/.test(sql)) return [[{ is_system: isSystem }]];
    if (/SELECT id FROM snmp_profiles p/.test(sql)) return [visible ? [{ id: 10 }] : []];
    if (/SELECT organization_id FROM snmp_profiles/.test(sql)) return [[{ organization_id: rows[0]?.organization_id ?? null }]];
    if (/FROM snmp_profiles/i.test(sql)) return [rows];
    if (/FROM snmp_profile_oids/i.test(sql)) return [[]];
    if (/^UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    if (/^INSERT/i.test(sql)) return [{ insertId: 12, affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}
const listSql = () => db.query.mock.calls.find(([s]) => /FROM snmp_profiles p/.test(s) && !/COUNT/.test(s) && !/SELECT id FROM/.test(s));
const writes = () => db.query.mock.calls.filter(([s]) => /^(UPDATE|INSERT|DELETE)/i.test(s) && /snmp_profile/i.test(s));

beforeEach(() => { jest.clearAllMocks(); wire(); });

describe('reads admit my org, system profiles and legacy rows', () => {
  it('never emits a bare organization_id = ?', async () => {
    // A bare predicate would hide the entire shipped vendor library and leave
    // every install staring at an empty profile list.
    await auth(request(app).get('/api/v1/snmp-profiles'));
    expect(listSql()[0]).toMatch(/organization_id = \? OR p\.organization_id IS NULL/);
  });

  it('flags an unattributed legacy row but NOT a system one', async () => {
    // is_system already explains why a system profile is uneditable; calling it
    // "unattributed" as well would be two different reasons for one state.
    await auth(request(app).get('/api/v1/snmp-profiles'));
    expect(listSql()[0]).toMatch(/organization_id IS NULL AND p\.is_system = 0\) AS is_unattributed/);
  });

  it('binds the org before any filter', async () => {
    await auth(request(app).get('/api/v1/snmp-profiles?manufacturer=MikroTik&status=active'));
    expect(listSql()[1][0]).toBe(1);
  });

  it('GET /:id is scoped too', async () => {
    wire({ rows: [] });
    const res = await auth(request(app).get('/api/v1/snmp-profiles/999'));
    expect(res.status).toBe(404);
  });
});

describe('a system profile cannot be changed by anyone', () => {
  it.each([
    ['put', '/api/v1/snmp-profiles/2'],
    ['delete', '/api/v1/snmp-profiles/2'],
  ])('%s is refused', async (method, url) => {
    wire({ rows: [SYSTEM], isSystem: 1 });
    const res = await auth(request(app)[method](url)).send({ name: 'hijacked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SYSTEM_PROFILE_IMMUTABLE');
  });

  it('writes nothing when refusing', async () => {
    wire({ rows: [SYSTEM], isSystem: 1 });
    await auth(request(app).put('/api/v1/snmp-profiles/2')).send({ name: 'hijacked' });
    expect(writes()).toHaveLength(0);
  });

  it('cannot be gutted through its OIDs — the lock bypass', async () => {
    // Adding or deleting OIDs would change what every tenant polls without
    // ever touching the profile row the lock protects.
    wire({ rows: [SYSTEM], isSystem: 1 });
    const del = await auth(request(app).delete('/api/v1/snmp-profiles/2/oids/5'));
    expect(del.status).toBe(403);
    const post = await auth(request(app).post('/api/v1/snmp-profiles/2/oids'))
      .send({ oid: '1.3.6.1', metric_column: 'cpu_usage', label: 'CPU' });
    expect(post.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('is still READABLE — it is the shipped library, not a secret', async () => {
    wire({ rows: [SYSTEM], isSystem: 1, visible: true });
    const res = await auth(request(app).get('/api/v1/snmp-profiles/2/oids'));
    expect(res.status).toBe(200);
  });

  it('a tenant cannot mark its own profile as system', async () => {
    // is_system is absent from fillable, so it can never be set through the API.
    const SnmpProfile = require('../src/models/SnmpProfile');
    expect(SnmpProfile.fillable).not.toContain('is_system');
  });
});

describe("OID routes cannot reach another tenant's profile", () => {
  it.each([
    ['get', '/api/v1/snmp-profiles/10/oids'],
    ['post', '/api/v1/snmp-profiles/10/oids'],
    ['delete', '/api/v1/snmp-profiles/10/oids/5'],
  ])('%s 404s when the profile is not visible', async (method, url) => {
    wire({ visible: false });
    const res = await auth(request(app)[method](url))
      .send({ oid: '1.3.6.1', metric_column: 'cpu_usage', label: 'CPU' });
    expect(res.status).toBe(404);
  });

  it('the visibility probe carries the org predicate', async () => {
    await auth(request(app).get('/api/v1/snmp-profiles/10/oids'));
    const probe = db.query.mock.calls.find(([s]) => /SELECT id FROM snmp_profiles p/.test(s));
    expect(probe).toBeDefined();
    expect(probe[0]).toMatch(/organization_id = \? OR p\.organization_id IS NULL/);
  });
});

describe('the write predicate itself', () => {
  it('hasOrgScope must stay true', () => {
    // Route guards run BEFORE the model; what actually stops one tenant writing
    // another's profile is BaseModel emitting `AND organization_id = ?`.
    const SnmpProfile = require('../src/models/SnmpProfile');
    expect(SnmpProfile.hasOrgScope).toBe(true);
  });

  it('a tenant profile CAN still be edited', async () => {
    wire({ rows: [MINE], isSystem: 0 });
    const res = await auth(request(app).put('/api/v1/snmp-profiles/10')).send({ name: 'Renamed' });
    expect(res.body.error?.code).not.toBe('SYSTEM_PROFILE_IMMUTABLE');
  });

  it('an unattributed legacy row is adopted, not blocked', async () => {
    wire({ rows: [LEGACY], isSystem: 0 });
    await auth(request(app).put('/api/v1/snmp-profiles/11')).send({ name: 'Claimed' });
    const adopt = db.query.mock.calls.find(
      ([s]) => /^UPDATE snmp_profiles SET organization_id = \? WHERE id = \? AND organization_id IS NULL/.test(s),
    );
    expect(adopt).toBeDefined();
    expect(adopt[1][0]).toBe(1);
  });
});
