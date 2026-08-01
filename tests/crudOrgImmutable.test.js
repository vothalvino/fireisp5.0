'use strict';
// =============================================================================
// FireISP 5.0 — generic CRUD must never move a record between tenants
// =============================================================================
// A live cross-tenant WRITE, proven on a running install before this fix:
//
//   PUT /clients/54 {"organization_id": 4}   -> 500 INTERNAL_ERROR
//     org 5 (the owner) then sees 404  — the record LEFT their tenant
//     org 4 then sees 200              — with attacker-controlled name/email
//
// The write committed and then returned 500, because crudController re-reads
// the row after updating and that read is scoped to the OLD org — so it finds
// nothing and throws. The caller sees a server error for an operation that
// succeeded.
//
// The chain: organization_id must be in `fillable` (create injects it — see
// orgScopedFillable.test.js, which enforces exactly that on 134 models), the
// update validation schemas do not declare it, and validate() IGNORES
// undeclared fields rather than stripping them. So it flowed straight to
// Model.update.
//
// 66 routes mount ctrl.update. Four guarded this individually (outages,
// invoices, scheduledTasks, speedTests); the other 62 did not. The guard now
// lives in applyUpdate — the single funnel both the transactional and the
// plain update path go through — so a new route cannot forget it.
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

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };
const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);

const CLIENT = { id: 54, organization_id: 1, name: 'Probe', client_type: 'residential' };

function wireDb() {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: 1 }]];
    if (/^UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    if (/^INSERT/i.test(sql)) return [{ insertId: 55, affectedRows: 1 }];
    if (/FROM `?clients`?/i.test(sql)) return [[CLIENT]];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
  db.getConnection.mockImplementation(async () => ({
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(),
    release: jest.fn(), destroy: jest.fn(),
    execute: db.query.getMockImplementation(),
  }));
}

const updateSql = () => db.query.mock.calls.filter(([s]) => /^UPDATE `?clients`?/i.test(s));

beforeEach(() => { jest.clearAllMocks(); wireDb(); });

describe('a record cannot be moved to another organization', () => {
  it('refuses the reassignment with 422 ORG_IMMUTABLE', async () => {
    const res = await auth(request(app).put('/api/v1/clients/54')).send({ organization_id: 4 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORG_IMMUTABLE');
  });

  it('writes NOTHING — the row must not move and then report failure', async () => {
    // This is the part that mattered: the old behaviour committed the UPDATE
    // and only then threw, so "500" meant "it worked, in the attacker's
    // favour". Asserting the status alone would not have caught that.
    await auth(request(app).put('/api/v1/clients/54')).send({ organization_id: 4 });
    expect(updateSql()).toHaveLength(0);
  });

  it('refuses even when smuggled alongside legitimate fields', async () => {
    const res = await auth(request(app).put('/api/v1/clients/54'))
      .send({ name: 'Renamed', organization_id: 4 });
    expect(res.status).toBe(422);
    expect(updateSql()).toHaveLength(0);
  });

  it('refuses an explicit null — orphaning is a move too', async () => {
    // NULL means "unattributed" on the backfilled tables, which is visible to
    // every tenant. Nulling a row is a leak, not a deletion.
    const res = await auth(request(app).put('/api/v1/clients/54')).send({ organization_id: null });
    expect(res.status).toBe(422);
    expect(updateSql()).toHaveLength(0);
  });
});

describe('legitimate traffic is untouched', () => {
  it('an ordinary edit still succeeds', async () => {
    const res = await auth(request(app).put('/api/v1/clients/54')).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(updateSql().length).toBeGreaterThan(0);
  });

  it('create still injects the org — the guard must not cover create', async () => {
    // crudController.create deliberately sets req.body.organization_id. If the
    // guard were applied there too, every POST on 134 models would 422.
    const res = await auth(request(app).post('/api/v1/clients'))
      .send({ name: 'New', client_type: 'residential' });
    expect(res.status).toBe(201);
    const ins = db.query.mock.calls.find(([s]) => /^INSERT INTO `?clients`?/i.test(s));
    expect(ins[0]).toMatch(/`organization_id`/);
  });
});
