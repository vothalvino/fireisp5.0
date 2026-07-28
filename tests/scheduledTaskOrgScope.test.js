'use strict';
// =============================================================================
// FireISP 5.0 — scheduled tasks are org-scoped, globals stay read-only (j36)
// =============================================================================
// ScheduledTask declared hasOrgScope=false, and BaseModel omits the org
// predicate SILENTLY when it does — so list/get/update/delete ran unscoped and
// one tenant could see, edit and DELETE another tenant's scheduled jobs. The
// run route was worse: findByIdOrFail with no org argument at all.
//
// It could NOT simply be flipped to hasOrgScope=true. Global system tasks are
// seeded with `SELECT NULL` for the org on purpose — data_retention, the
// config-backup pull, apply_late_fees, the TLS monitor. A plain
// `organization_id = ?` hides every one of them from every tenant, which is
// worse than the leak: the operator believes nothing is scheduled.
//
// Same treatment as the shared NULL-org tax rates in #566: reads admit the
// global rows and flag them, writes refuse them.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/taskRunner', () => ({
  runTask: jest.fn().mockResolvedValue({ ok: true }),
  markTaskRun: jest.fn().mockResolvedValue(undefined),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const taskRunner = require('../src/services/taskRunner');
const app = require('../src/app');

const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);
const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };

const OWN = { id: 20, organization_id: 1, task_name: 'my_org_sweep', is_global: 0 };
const GLOBAL = { id: 3, organization_id: null, task_name: 'data_retention', is_global: 1 };

function wireDb({ rows = [OWN, GLOBAL], targetOrg } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: rows.length }]];
    if (/SELECT organization_id FROM scheduled_tasks WHERE id = \?/.test(sql)) {
      return [targetOrg === undefined ? [] : [{ organization_id: targetOrg }]];
    }
    if (/FROM scheduled_tasks/.test(sql)) return [rows];
    if (/^UPDATE `?scheduled_tasks`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const listSql = () => db.query.mock.calls.find(c => /FROM scheduled_tasks/.test(c[0]) && /is_global/.test(c[0]));

beforeEach(() => jest.clearAllMocks());

describe('the list admits the org’s own tasks AND the global ones', () => {
  it('queries org rows OR NULL-org rows, flagging the globals', async () => {
    wireDb();
    const res = await auth(request(app).get('/api/v1/scheduled-tasks'));
    expect(res.status).toBe(200);
    expect(listSql()[0]).toMatch(/organization_id = \? OR organization_id IS NULL/);
    expect(listSql()[0]).toMatch(/AS is_global/);
  });

  it('never emits a bare organization_id = ? — that would hide every system task', async () => {
    // The failure this guards: an operator opens the page, sees no
    // data_retention, no TLS monitor, and concludes nothing is scheduled.
    wireDb();
    await auth(request(app).get('/api/v1/scheduled-tasks'));
    expect(listSql()[0]).not.toMatch(/WHERE organization_id = \?[^ ]/);
    expect(listSql()[0]).toMatch(/IS NULL/);
  });

  it('GET /:id resolves a global task rather than 404ing it', async () => {
    wireDb({ rows: [GLOBAL] });
    const res = await auth(request(app).get('/api/v1/scheduled-tasks/3'));
    expect(res.status).toBe(200);
    expect(res.body.data.task_name).toBe('data_retention');
  });

  it('binds the org before any filter, so the predicates cannot swap', async () => {
    wireDb();
    await auth(request(app).get('/api/v1/scheduled-tasks?is_enabled=true'));
    expect(listSql()[1][0]).toBe(1);
  });
});

describe('a global task cannot be changed by one tenant', () => {
  it.each([
    ['PUT', () => auth(request(app).put('/api/v1/scheduled-tasks/3')).send({ is_enabled: false })],
    ['DELETE', () => auth(request(app).delete('/api/v1/scheduled-tasks/3')).send()],
  ])('%s → 403 GLOBAL_TASK_READONLY, and nothing is written', async (_v, go) => {
    // One org disabling data_retention for EVERY org is exactly the silent
    // cross-tenant damage this job is about.
    wireDb({ targetOrg: null });
    const res = await go();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GLOBAL_TASK_READONLY');
    expect(db.query.mock.calls.some(c => /^UPDATE `?scheduled_tasks`?/i.test(c[0]))).toBe(false);
  });

  it("still allows editing the org's OWN task", async () => {
    wireDb({ targetOrg: 1, rows: [OWN] });
    const res = await auth(request(app).put('/api/v1/scheduled-tasks/20')).send({ is_enabled: false });
    expect(res.status).not.toBe(403);
  });
});

describe('running a task', () => {
  it('a global task IS runnable — running is not editing', async () => {
    // Forcing a retention sweep on your own install is legitimate.
    wireDb({ rows: [GLOBAL] });
    const res = await auth(request(app).post('/api/v1/scheduled-tasks/3/run')).send();
    expect(res.status).toBe(200);
    expect(taskRunner.runTask).toHaveBeenCalledWith('data_retention', 1);
  });

  it("404s another tenant's task instead of running it", async () => {
    // Was findByIdOrFail with NO org argument: any id, any tenant.
    wireDb({ rows: [] });
    const res = await auth(request(app).post('/api/v1/scheduled-tasks/999/run')).send();
    expect(res.status).toBe(404);
    expect(taskRunner.runTask).not.toHaveBeenCalled();
  });

  it('scopes the run lookup itself', async () => {
    wireDb({ rows: [OWN] });
    await auth(request(app).post('/api/v1/scheduled-tasks/20/run')).send();
    const q = db.query.mock.calls.find(c => /FROM scheduled_tasks WHERE id = \?/.test(c[0]));
    expect(q[0]).toMatch(/organization_id = \? OR organization_id IS NULL/);
  });
});
