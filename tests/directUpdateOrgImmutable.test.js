'use strict';
// =============================================================================
// FireISP 5.0 — routes that bypass crudController still cannot re-home a record
// =============================================================================
// #604 put the ORG_IMMUTABLE check in crudController.applyUpdate. Right idea,
// wrong altitude: TWELVE routes call
//
//     Model.update(req.params.id, req.body, req.orgId)
//
// directly and never touch crudController, so the exact exploit #604 was
// written to close stayed reachable on contracts, devices, chargebacks,
// billing disputes, refund requests, IP pools, network links, CPE profiles and
// firmware versions/campaigns. An adversarial reviewer reproduced it at runtime
// on nine of them.
//
// The chain is three individually-sensible pieces:
//   1. organization_id MUST be in `fillable` — create injects it, and
//      orgScopedFillable.test.js enforces that on 136 models.
//   2. The update schemas do not declare it.
//   3. validate() IGNORES undeclared fields rather than stripping them.
// So it flows from the request body straight into the SET clause.
//
// Direction matters and the original report had it backwards: the WHERE binds
// req.orgId, so a caller can only PUSH their own row into another tenant, never
// PULL a victim's out. That is still an authenticated user injecting a contract,
// dispute or firmware campaign into an org that never created it — and making
// it vanish from their own.
//
// The fix is in BaseModel.update, the narrowest point all of them share. j57
// noted "nothing in the repo enumerates these routes, so there is no test that
// fails" — so this file enumerates them.
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

// Every route named in j57, with a minimal valid body for its schema. The body
// matters: a 422 from failed validation would look like a pass while proving
// nothing, so each carries the fields its schema requires.
const ROUTES = [
  ['/api/v1/contracts/7', { status: 'active' }],
  ['/api/v1/devices/7', { name: 'X' }],
  ['/api/v1/chargebacks/7', { status: 'won' }],
  ['/api/v1/billing-disputes/7', { status: 'open' }],
  ['/api/v1/refund-requests/7', { status: 'pending' }],
  ['/api/v1/ip-pools/7', { name: 'P' }],
  ['/api/v1/network-links/7', { name: 'L' }],
  ['/api/v1/cpe-profiles/7', { name: 'C' }],
  ['/api/v1/cpe-management/firmware-versions/7', { version: '1.0' }],
  ['/api/v1/cpe-management/firmware-campaigns/7', { name: 'K' }],
];

const EXISTING = { id: 7, organization_id: 1, name: 'mine', status: 'active' };

function wireDb() {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: 1 }]];
    if (/^UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    if (/^INSERT/i.test(sql)) return [{ insertId: 8, affectedRows: 1 }];
    return [[EXISTING]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
  db.getConnection.mockImplementation(async () => ({
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(),
    release: jest.fn(), destroy: jest.fn(), execute: db.query.getMockImplementation(),
  }));
}

/** Any UPDATE that would move a row between orgs. */
const orgMovingUpdates = () => db.query.mock.calls.filter(
  ([s]) => /^UPDATE/i.test(s) && /`organization_id` = \?/.test(s),
);

beforeEach(() => { jest.clearAllMocks(); wireDb(); });

describe('no route can push a record into another tenant', () => {
  it.each(ROUTES)('PUT %s refuses organization_id', async (path, body) => {
    const res = await auth(request(app).put(path)).send({ ...body, organization_id: 4 });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('ORG_IMMUTABLE');
  });

  it.each(ROUTES)('PUT %s emits no org-moving UPDATE', async (path, body) => {
    // The status code alone is not enough. #604's own bug was a write that
    // COMMITTED and then returned an error, so the assertion that matters is
    // that no such statement reached the database at all.
    await auth(request(app).put(path)).send({ ...body, organization_id: 4 });
    expect(orgMovingUpdates()).toHaveLength(0);
  });

  it('refuses an explicit null too — orphaning is a move', async () => {
    const res = await auth(request(app).put('/api/v1/contracts/7')).send({ organization_id: null });
    expect(res.status).toBe(422);
    expect(orgMovingUpdates()).toHaveLength(0);
  });

  it('PATCH is covered as well as PUT', async () => {
    // contracts.js mounts the same handler on both verbs.
    const res = await auth(request(app).patch('/api/v1/contracts/7')).send({ organization_id: 4 });
    expect(res.status).toBe(422);
  });
});

describe('ordinary edits still work', () => {
  it.each(ROUTES)('PUT %s succeeds without organization_id', async (path, body) => {
    const res = await auth(request(app).put(path)).send(body);
    // Not asserting 200 specifically: some of these have their own business
    // rules. What must be true is that the guard is not what stopped them.
    expect(res.body.error?.code).not.toBe('ORG_IMMUTABLE');
  });
});

describe('the guard lives at the funnel, not per route', () => {
  it('BaseModel.update refuses regardless of which model calls it', async () => {
    // Asserting on the model is what covers the routes nobody remembered to
    // enumerate — including any added after this test was written.
    const Contract = require('../src/models/Contract');
    await expect(Contract.update(7, { organization_id: 4 }, 1)).rejects.toMatchObject({
      statusCode: 422, code: 'ORG_IMMUTABLE',
    });
  });

  it('allows it on a model that is not org-scoped', async () => {
    // hasOrgScope=false means the column is not a tenancy boundary on that
    // table, so the guard must not fire and break unrelated writes.
    const BaseModel = require('../src/models/BaseModel');
    class Unscoped extends BaseModel {
      static get tableName() { return 'unscoped_thing'; }
      static get fillable() { return ['organization_id', 'name']; }
      static get hasOrgScope() { return false; }
    }
    await expect(Unscoped.update(7, { organization_id: 4 }, null)).resolves.toBeDefined();
  });

  it('does not fire when organization_id is simply absent', async () => {
    const Contract = require('../src/models/Contract');
    await expect(Contract.update(7, { status: 'active' }, 1)).resolves.toBeDefined();
  });
});
