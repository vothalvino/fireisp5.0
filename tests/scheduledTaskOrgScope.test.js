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
  withPrimaryContext: jest.fn((callback) => callback()),
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
const TENANT_ADMIN = {
  id: 1, email: 'a@b.c', role: 'admin', status: 'active',
  organization_id: 1, is_install_operator: 0,
};
const OPERATOR = { ...TENANT_ADMIN, is_install_operator: 1 };

const OWN = { id: 20, organization_id: 1, task_name: 'my_org_sweep', is_global: 0 };
const GLOBAL = { id: 3, organization_id: null, task_name: 'data_retention', is_global: 1 };

function wireDb({ rows = [OWN, GLOBAL], targetOrg, user = OPERATOR } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[user]];
    if (/SELECT is_install_operator FROM users/.test(sql)) {
      return [[{ is_install_operator: user.is_install_operator }]];
    }
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
  it('lets the install operator run a global task with its actual NULL scope', async () => {
    wireDb({ rows: [GLOBAL], user: OPERATOR });
    const res = await auth(request(app).post('/api/v1/scheduled-tasks/3/run')).send();
    expect(res.status).toBe(200);
    expect(taskRunner.runTask).toHaveBeenCalledWith('data_retention', null);
    expect(taskRunner.markTaskRun).not.toHaveBeenCalled();
    expect(db.query.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        expect.stringMatching(/UPDATE scheduled_tasks SET last_status = \?, last_run_at = NOW\(\) WHERE id = \?/),
        ['success', 3],
      ]),
    ]));
  });

  it('refuses an install-wide task to an ordinary tenant admin', async () => {
    wireDb({ rows: [GLOBAL], user: TENANT_ADMIN });
    const res = await auth(request(app).post('/api/v1/scheduled-tasks/3/run')).send();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTALL_OPERATOR_ONLY');
    expect(taskRunner.runTask).not.toHaveBeenCalled();
  });

  it("lets the install operator run an org-owned task with the row's organization scope", async () => {
    wireDb({ rows: [OWN], user: OPERATOR });
    const res = await auth(request(app).post('/api/v1/scheduled-tasks/20/run')).send();
    expect(res.status).toBe(200);
    expect(taskRunner.runTask).toHaveBeenCalledWith('my_org_sweep', 1);
  });

  it('refuses an org-owned task to a tenant admin so a global handler name cannot bypass the gate', async () => {
    const spoofed = { ...OWN, task_name: 'data_retention' };
    wireDb({ rows: [spoofed], user: TENANT_ADMIN });

    const res = await auth(request(app).post('/api/v1/scheduled-tasks/20/run')).send();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTALL_OPERATOR_ONLY');
    expect(taskRunner.runTask).not.toHaveBeenCalled();
  });

  it('refuses creating an enabled spoofed global handler under an org', async () => {
    wireDb({ rows: [], user: TENANT_ADMIN });

    const res = await auth(request(app).post('/api/v1/scheduled-tasks')).send({
      task_name: 'data_retention',
      task_type: 'radius_sync',
      cron_expression: '* * * * *',
      is_enabled: true,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTALL_OPERATOR_ONLY');
    expect(db.query.mock.calls.some(([sql]) => /^INSERT INTO `?scheduled_tasks`?/i.test(sql))).toBe(false);
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

// =============================================================================
// The two holes #582 left, which its own review did not catch
// =============================================================================
// #582 fixed the READ leak (globals visible, flagged, read-only) and stopped
// there. Two things it missed, both because ScheduledTask.hasOrgScope stayed
// false while the table HAS an organization_id:
//
//   1. crudController injects organization_id on create ONLY when the flag is
//      true — so every task a tenant created was written NULL-org, i.e. GLOBAL,
//      and its own creator was then 403'd out of editing it. Silent: it looks
//      like the task was created fine.
//   2. update/delete/restore went through BaseModel with NO org predicate.
//      blockGlobalTaskWrites did not catch it, because another org's task is
//      not global — the guard waved it through.
//
// This is why the pattern had to be fixed BEFORE outages and speed_tests copy
// it four more times.
describe('#582 follow-up: a tenant task is OWNED, not global', () => {
  it('stamps the creating org, so the task is not born global', async () => {
    // If organization_id is missing from the INSERT the row is NULL-org, which
    // this table treats as "shared by every organization" — the creator then
    // cannot edit their own task.
    wireDb({ rows: [] });
    db.query.mockImplementation(async (sql) => {
      if (isUserLookup(sql)) return [[OPERATOR]];
      if (/SELECT is_install_operator FROM users/.test(sql)) return [[{ is_install_operator: 1 }]];
      if (/^INSERT INTO `?scheduled_tasks`?/i.test(sql)) return [{ insertId: 77 }];
      // BaseModel backticks the table name; the hand-written route queries do
      // not. Matching only the unquoted form makes the create read-back return
      // nothing and the route 500s on a null record.
      if (/FROM `?scheduled_tasks`?/.test(sql)) return [[{ id: 77, organization_id: 1, task_name: 'my_sweep' }]];
      return [[]];
    });
    db.execute.mockImplementation(db.query.getMockImplementation());

    const res = await auth(request(app).post('/api/v1/scheduled-tasks'))
      .send({ task_name: 'my_sweep', task_type: 'radius_sync', cron_expression: '0 3 * * *' });

    expect([200, 201]).toContain(res.status);
    const insert = db.query.mock.calls.find(([s]) => /^INSERT INTO `?scheduled_tasks`?/i.test(s));
    expect(insert).toBeDefined();
    expect(insert[0]).toMatch(/organization_id/);
    expect(insert[1]).toContain(1);
  });

  it("scopes an UPDATE, so another tenant's task is not writable", async () => {
    // The row is NOT global (organization_id 2), so blockGlobalTaskWrites lets
    // it through by design — BaseModel's org predicate is what must stop it.
    wireDb({ targetOrg: 2, rows: [] });
    const res = await auth(request(app).put('/api/v1/scheduled-tasks/50')).send({ is_enabled: false });

    expect(res.status).not.toBe(200);
    const upd = db.query.mock.calls.find(([s]) => /^UPDATE `?scheduled_tasks`?/i.test(s));
    if (upd) expect(upd[0]).toMatch(/organization_id = \?/);
  });

  it('scopes a DELETE the same way', async () => {
    wireDb({ targetOrg: 2, rows: [] });
    const res = await auth(request(app).delete('/api/v1/scheduled-tasks/50')).send();
    expect(res.status).not.toBe(204);
    const del = db.query.mock.calls.find(([s]) => /^UPDATE `?scheduled_tasks`? SET deleted_at|^DELETE FROM `?scheduled_tasks`?/i.test(s));
    if (del) expect(del[0]).toMatch(/organization_id = \?/);
  });

  it('refuses to MOVE a task between organizations', async () => {
    // organization_id is fillable (create needs it) and undeclared in the
    // update schema, and validate() ignores undeclared fields rather than
    // stripping them — so without this guard a PUT could reassign the row, or
    // set it NULL and promote it to a global nobody can edit.
    wireDb({ targetOrg: 1, rows: [{ id: 20, organization_id: 1, task_name: 'mine' }] });
    const res = await auth(request(app).put('/api/v1/scheduled-tasks/20'))
      .send({ organization_id: 2, is_enabled: false });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORG_IMMUTABLE');
    expect(db.query.mock.calls.some(([s]) => /^UPDATE `?scheduled_tasks`?/i.test(s))).toBe(false);
  });

  it('promoting a task to GLOBAL via organization_id: null is refused too', async () => {
    wireDb({ targetOrg: 1, rows: [{ id: 20, organization_id: 1, task_name: 'mine' }] });
    const res = await auth(request(app).put('/api/v1/scheduled-tasks/20'))
      .send({ organization_id: null });
    expect(res.status).toBe(422);
  });
});
