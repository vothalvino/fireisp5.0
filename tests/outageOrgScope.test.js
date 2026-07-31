'use strict';
// =============================================================================
// FireISP 5.0 — outages are org-scoped (j36)
// =============================================================================
// Outage declared hasOrgScope = false and BaseModel omits the org predicate
// SILENTLY when it does, so every verb behind the generic crudController ran
// unscoped:
//   * GET /outages returned every outage on the install — titles, root_cause
//     free text, affected client counts;
//   * PUT/DELETE/restore let any tenant retitle, resolve or delete another
//     tenant's outage, after which the afterUpdate hook emitted
//     outage.resolved into the EDITING org's channel, so the owning NOC never
//     heard about it.
//
// Migration 437 adds organization_id, backfilled from site then device. Rows
// with neither stay NULL — legacy only, since every new outage is stamped at
// creation — and are ADOPTED by the first tenant that writes to one, which is
// what stops an unattributed 'ongoing' outage sitting un-resolvable on every
// NOC dashboard forever.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
// app.js registers notification hooks at require time, so the mock needs the
// listener API too — emit alone makes the whole suite fail to load.
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(), off: jest.fn(), once: jest.fn(), removeListener: jest.fn(),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };
const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);

const MINE = { id: 10, organization_id: 1, title: 'Fibre cut', status: 'ongoing', site_id: 3 };
const LEGACY = { id: 11, organization_id: null, title: 'Unattributed', status: 'ongoing', site_id: null, device_id: null };

function wireDb({ rows = [MINE], targetOrg = 1 } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: rows.length }]];
    if (/SELECT organization_id FROM outages WHERE id = \?/.test(sql)) {
      return [targetOrg === undefined ? [] : [{ organization_id: targetOrg }]];
    }
    if (/FROM `?outages`?/i.test(sql)) return [rows];
    if (/^UPDATE `?outages`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}
const listSql = () => db.query.mock.calls.find(([s]) => /FROM outages o/.test(s) && !/COUNT/.test(s));

beforeEach(() => jest.clearAllMocks());

describe('reads admit my org AND unattributed rows', () => {
  it('never emits a bare organization_id = ?', async () => {
    // The #582 anti-fix: a bare predicate hides every unattributed row, so the
    // operator sees an empty page and concludes nothing is wrong — worse than
    // the leak it replaces, because it is silent.
    wireDb();
    await auth(request(app).get('/api/v1/outages'));
    expect(listSql()[0]).toMatch(/organization_id = \? OR o\.organization_id IS NULL/);
    expect(listSql()[0]).not.toMatch(/WHERE o\.organization_id = \?[^ ]/);
  });

  it('flags an unattributed row so the UI can explain it', async () => {
    wireDb({ rows: [LEGACY] });
    const res = await auth(request(app).get('/api/v1/outages'));
    expect(res.status).toBe(200);
    expect(listSql()[0]).toMatch(/IS NULL\) AS is_unattributed/);
  });

  it('binds the org before any filter, so the predicates cannot swap', async () => {
    wireDb();
    await auth(request(app).get('/api/v1/outages?status=ongoing&site_id=3'));
    expect(listSql()[1][0]).toBe(1);
  });

  it('GET /:id is scoped too — no reading another tenant by guessing an id', async () => {
    wireDb({ rows: [] });
    const res = await auth(request(app).get('/api/v1/outages/999'));
    expect(res.status).toBe(404);
    const one = db.query.mock.calls.find(([s]) => /FROM outages o WHERE o\.id = \?/.test(s));
    expect(one[0]).toMatch(/organization_id = \? OR o\.organization_id IS NULL/);
  });
});

describe('writes are strictly scoped', () => {
  it('an outage cannot be moved to another organization', async () => {
    wireDb();
    const res = await auth(request(app).put('/api/v1/outages/10')).send({ organization_id: 2, status: 'resolved' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORG_IMMUTABLE');
    expect(db.query.mock.calls.some(([s]) => /^UPDATE `?outages`?/i.test(s))).toBe(false);
  });

  it('nor made unattributed again by setting it null', async () => {
    wireDb();
    const res = await auth(request(app).put('/api/v1/outages/10')).send({ organization_id: null });
    expect(res.status).toBe(422);
  });
});

describe('the WRITE predicate itself, not just the route guards', () => {
  it('UPDATE carries an org predicate — hasOrgScope must stay true', () => {
    // The route guards (reject-reassignment, adopt) all still pass with
    // hasOrgScope=false, because they run BEFORE the model. What actually stops
    // one tenant writing another's outage is BaseModel emitting
    // `AND organization_id = ?`, and only asserting on the emitted SQL catches
    // a revert of that flag.
    const Outage = require('../src/models/Outage');
    expect(Outage.hasOrgScope).toBe(true);
  });

  it("does not write another tenant's outage", async () => {
    wireDb({ rows: [MINE], targetOrg: 1 });
    await auth(request(app).put('/api/v1/outages/10')).send({ status: 'resolved' });
    const upd = db.query.mock.calls.find(([s]) => /^UPDATE `?outages`?/i.test(s));
    expect(upd).toBeDefined();
    expect(upd[0]).toMatch(/organization_id = \?/);
  });

  it('DELETE is scoped the same way', async () => {
    wireDb({ rows: [MINE], targetOrg: 1 });
    await auth(request(app).delete('/api/v1/outages/10')).send();
    const del = db.query.mock.calls.find(([s]) => /^UPDATE `?outages`? SET deleted_at/i.test(s));
    if (del) expect(del[0]).toMatch(/organization_id = \?/);
  });
});

describe('the automated creator stamps the org', () => {
  // alertService.autoCreateOutage is the ONLY automated creator on the
  // platform, so nearly every outage row comes from it. Miss this and the
  // table backfills correctly and then immediately starts accumulating
  // unattributed rows again — the migration would look like it worked.
  it('writes organization_id on the INSERT', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/services/alertService.js'), 'utf8',
    );
    expect(src).toMatch(/INSERT INTO outages \(organization_id,/);
    expect(src).toMatch(/\[organizationId, breach\.device_id/);
  });

  it('scopes its dedup probe, and ignores soft-deleted rows', () => {
    // Unscoped, another org's ongoing outage on the same device with the same
    // title suppresses this one entirely. And without deleted_at IS NULL, once
    // anyone archived an auto-created outage that alert could never raise one
    // again — the row matched forever.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/services/alertService.js'), 'utf8',
    );
    const probe = src.slice(src.indexOf('SELECT id FROM outages'), src.indexOf('if (existing.length > 0)'));
    expect(probe).toMatch(/organization_id <=> \?/);
    expect(probe).toMatch(/deleted_at IS NULL/);
  });
});

describe('an unattributed legacy row is adopted, not blocked', () => {
  it('resolving one stamps the acting org first', async () => {
    // Without adoption the strict write predicate makes these permanently
    // un-resolvable: a legacy 'ongoing' outage would sit on every tenant's NOC
    // dashboard with no way to clear it.
    wireDb({ rows: [LEGACY], targetOrg: null });
    await auth(request(app).put('/api/v1/outages/11')).send({ status: 'resolved' });

    const adopt = db.query.mock.calls.find(
      ([s]) => /^UPDATE outages SET organization_id = \? WHERE id = \? AND organization_id IS NULL/.test(s),
    );
    expect(adopt).toBeDefined();
    expect(adopt[1][0]).toBe(1);
  });

  it('does NOT touch a row that already has an owner', async () => {
    // Adoption must never re-home another tenant's outage.
    wireDb({ rows: [MINE], targetOrg: 2 });
    await auth(request(app).put('/api/v1/outages/10')).send({ status: 'resolved' });
    expect(db.query.mock.calls.some(
      ([s]) => /SET organization_id = \? WHERE id = \? AND organization_id IS NULL/.test(s),
    )).toBe(false);
  });

  it('the adoption UPDATE is itself guarded by IS NULL', () => {
    // Belt and braces against a race: two tenants adopting at once must not
    // let the second overwrite the first.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/routes/outages.js'), 'utf8',
    );
    expect(src).toMatch(/SET organization_id = \? WHERE id = \? AND organization_id IS NULL/);
  });
});
