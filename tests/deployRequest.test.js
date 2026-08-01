'use strict';
// =============================================================================
// FireISP 5.0 — deploy from the GUI, without giving the app any privilege
// =============================================================================
// The security property is not "the button works". It is:
//
//   THE APPLICATION CONTAINER CAN ONLY INSERT A ROW, AND THAT ROW CANNOT
//   INFLUENCE WHAT THE HOST RUNS.
//
// The refused design mounts the Docker socket into the app container, which is
// root on the host — an RCE in FireISP would own the machine rather than the
// app. The accepted design keeps the privilege in a systemd timer outside
// Docker that runs redeploy.sh with NO arguments.
//
// The subtle half is the request payload. If a request could name a commit, a
// tag or an image, a compromised app would gain an arbitrary-image-deploy
// primitive — most of what the socket would have given away. So these tests
// assert that no caller-supplied value reaches the row, and that the agent
// script contains no interpolation into the command it runs.
//
// The other failure mode guarded here is a stub that fakes success: on an
// install with no agent, POST must REFUSE rather than queue a request nobody
// will ever service.
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

const OPERATOR = { id: 1, email: 'op@b.c', role: 'admin', status: 'active', organization_id: 1 };
const TENANT = { id: 2, email: 't@b.c', role: 'manager', status: 'active', organization_id: 1 };
const tokenFor = (u) => jwt.sign({ sub: u.id, email: u.email, role: u.role, orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const as = (u) => (r) => r.set('Authorization', `Bearer ${tokenFor(u)}`);

function wire({ user = OPERATOR, agentAlive = true, request: req = null } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[user]];
    if (/FROM deploy_requests/.test(sql)) return [req ? [req] : []];
    if (/FROM deploy_agent_status/.test(sql)) {
      return [[{ last_seen_at: '2026-08-01T00:00:00Z', agent_version: '1', hostname: 'h', alive: agentAlive ? 1 : 0 }]];
    }
    if (/^INSERT INTO deploy_requests/.test(sql)) return [{ insertId: 77, affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}
const insertCall = () => db.query.mock.calls.find(([s]) => /^INSERT INTO deploy_requests/.test(s));

beforeEach(() => jest.clearAllMocks());

describe('the request cannot influence what the host runs', () => {
  it('accepts no target, even when one is supplied', async () => {
    // The whole security argument. A commit/image/tag reaching the row would
    // make this an arbitrary-image-deploy primitive.
    wire();
    await as(OPERATOR)(request(app).post('/api/v1/system/deploy'))
      .send({ commit: 'deadbeef', image: 'evil/image:latest', tag: 'v9', ref: 'attacker' });

    const ins = insertCall();
    expect(ins).toBeDefined();
    // Only the acting user id is bound. Nothing from the body.
    expect(ins[1]).toEqual([OPERATOR.id]);
    const sqlText = ins[0];
    for (const smell of ['commit', 'image', 'tag', 'ref']) {
      expect(sqlText.toLowerCase()).not.toContain(smell);
    }
  });

  it('inserts exactly one row and issues no other write', async () => {
    wire();
    await as(OPERATOR)(request(app).post('/api/v1/system/deploy')).send({});
    const writes = db.query.mock.calls.filter(([s]) => /^(INSERT|UPDATE|DELETE)/i.test(s));
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toMatch(/^INSERT INTO deploy_requests/);
  });

  it('records who asked, for the audit trail', async () => {
    wire();
    await as(OPERATOR)(request(app).post('/api/v1/system/deploy')).send({});
    expect(insertCall()[1]).toContain(OPERATOR.id);
  });
});

describe('it refuses rather than queueing for nobody', () => {
  it('503s when no agent has checked in', async () => {
    // Otherwise the request sits 'pending' forever while the UI implies work is
    // happening — a stub whose UI fakes success.
    wire({ agentAlive: false });
    const res = await as(OPERATOR)(request(app).post('/api/v1/system/deploy')).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPLOY_AGENT_UNAVAILABLE');
  });

  it('writes nothing when it refuses', async () => {
    wire({ agentAlive: false });
    await as(OPERATOR)(request(app).post('/api/v1/system/deploy')).send({});
    expect(insertCall()).toBeUndefined();
  });

  it('tells the operator what to do instead', async () => {
    wire({ agentAlive: false });
    const res = await as(OPERATOR)(request(app).post('/api/v1/system/deploy')).send({});
    expect(res.body.error.message).toMatch(/redeploy/);
  });

  it.each([['pending'], ['running']])('409s while a %s deploy exists', async (status) => {
    wire({ request: { id: 5, status } });
    const res = await as(OPERATOR)(request(app).post('/api/v1/system/deploy')).send({});
    expect(res.status).toBe(409);
    expect(insertCall()).toBeUndefined();
  });

  it.each([['succeeded'], ['failed']])('allows a new deploy after a %s one', async (status) => {
    wire({ request: { id: 5, status } });
    const res = await as(OPERATOR)(request(app).post('/api/v1/system/deploy')).send({});
    expect(res.status).toBe(202);
  });
});

describe('install operator only', () => {
  it.each([['GET'], ['POST']])('%s 404s for a tenant admin', async (method) => {
    wire({ user: TENANT });
    const res = method === 'GET'
      ? await as(TENANT)(request(app).get('/api/v1/system/deploy'))
      : await as(TENANT)(request(app).post('/api/v1/system/deploy')).send({});
    expect(res.status).toBe(404);
  });

  it('a tenant admin cannot queue a deploy', async () => {
    wire({ user: TENANT });
    await as(TENANT)(request(app).post('/api/v1/system/deploy')).send({});
    expect(insertCall()).toBeUndefined();
  });

  it('requires authentication', async () => {
    wire();
    const res = await request(app).post('/api/v1/system/deploy').send({});
    expect([401, 403]).toContain(res.status);
  });
});

describe('the agent script keeps the invariant', () => {
  const src = () => require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../deploy-agent.sh'), 'utf8',
  );

  it('runs redeploy.sh with no arguments', () => {
    // Written literally rather than assembled in a variable, so that this
    // assertion is possible at all.
    expect(src()).toMatch(/"\$APP_DIR\/redeploy\.sh" 2>&1/);
  });

  it('never interpolates a database value into the command', () => {
    const s = src();
    const cmdLine = s.split('\n').find(l => l.includes('redeploy.sh') && l.includes('OUTPUT='));
    expect(cmdLine).toBeDefined();
    // The only expansion permitted on that line is APP_DIR, which comes from
    // the environment, never from a query.
    expect(cmdLine).not.toMatch(/REQUEST|TARGET|COMMIT|IMAGE|TAG/);
  });

  it('claims work by UPDATE, not select-then-update', () => {
    // Two overlapping timer runs must not both run redeploy.sh. Only the row
    // still 'pending' is claimed, so the loser's UPDATE matches nothing.
    expect(src()).toMatch(/UPDATE deploy_requests\s*\n?\s*SET status = 'running'[\s\S]{0,120}WHERE status = 'pending'/);
  });

  it('keeps the password out of argv', () => {
    // `mysql -p<pass>` is visible in `ps` to every user on the box.
    expect(src()).toMatch(/MYSQL_PWD=/);
    expect(src()).not.toMatch(/mysql[^\n]*-p\$/);
  });

  it('stamps the heartbeat before doing any work', () => {
    const s = src();
    expect(s.indexOf('deploy_agent_status')).toBeLessThan(s.indexOf('redeploy.sh" 2>&1'));
  });

  it('names a compose service that ACTUALLY EXISTS', () => {
    // This is the test that was missing, and its absence cost a live outage of
    // the feature: the agent shipped calling `docker compose exec -T db`, but
    // the MySQL service is `db-primary`. Every run died with "no such service",
    // so the heartbeat was never written, agent_alive stayed false and the
    // Update button never appeared — with the UI correctly reporting "no agent
    // installed" to an operator who had installed one.
    //
    // Asserting on the script's TEXT (which the tests above do) cannot catch a
    // name that is well-formed but wrong. This reads the compose file.
    const compose = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../docker-compose.prod.yml'), 'utf8',
    );
    const services = compose
      .slice(compose.indexOf('\nservices:'))
      .split('\n')
      .map(l => l.match(/^ {2}([a-z][a-z0-9_-]*):/))
      .filter(Boolean)
      .map(m => m[1]);

    const declared = src().match(/DB_SERVICE="\$\{FIREISP_DB_SERVICE:-([a-z0-9_-]+)\}"/);
    expect(declared).not.toBeNull();
    expect(services).toContain(declared[1]);
  });

  it('runs from the checkout, not a copy in /usr/local/bin', () => {
    // A copy is a second thing to keep in step: redeploy pulls a fixed agent
    // into /opt/fireisp, the copy stays stale, and the symptom is an agent that
    // silently keeps failing the old way.
    const unit = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../deploy/fireisp-deploy-agent.service'), 'utf8',
    );
    expect(unit).toMatch(/^ExecStart=\/opt\/fireisp\/deploy-agent\.sh$/m);
    // Directives only — the comment above ExecStart legitimately explains why
    // /usr/local/bin is NOT used, and a blunt string match flags its own
    // rationale.
    const directives = unit.split('\n').filter(l => /^[A-Z][A-Za-z]*=/.test(l));
    expect(directives.join('\n')).not.toMatch(/\/usr\/local\/bin/);
  });

  it('sweeps a deploy that never reported back', () => {
    // A run killed mid-deploy would otherwise leave a 'running' row that the
    // agent re-claims forever.
    expect(src()).toMatch(/status = 'failed'[\s\S]{0,400}INTERVAL 1 HOUR/);
  });
});


// ---------------------------------------------------------------------------
// The agent installs itself
// ---------------------------------------------------------------------------
// The units used to be a four-command manual step in the docs, which meant the
// Update button only worked for an operator who had read them — and, worse,
// that a FIX to the agent never reached anyone who had already installed it,
// because the install copied the script somewhere redeploy does not touch.
// Both were real: the agent shipped naming a compose service that does not
// exist, and the copy would have kept failing the same way after the fix
// landed.
//
// So the deploy installs its own units, the same way it applies its own
// migrations. These assert the guards that make that safe — every one of them
// must SKIP rather than fail, because a cosmetic convenience must never be able
// to break a deploy.

describe('redeploy installs the deploy-agent units', () => {
  const script = require('node:path').join(__dirname, '../redeploy.sh');
  const run = (env) => require('node:child_process').execFileSync(
    'bash',
    ['-c', `set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; ${env} install_deploy_agent`, 'bash', script],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  it('is wired into the deploy flow, not just defined', () => {
    const src = require('node:fs').readFileSync(script, 'utf8');
    expect(src).toMatch(/^install_deploy_agent$/m);
  });

  it('honours an operator who does not want a timer', () => {
    expect(run('DEPLOY_AGENT=0;')).toMatch(/skipping/);
  });

  it('skips a host with no systemd rather than failing the deploy', () => {
    const out = require('node:child_process').execFileSync(
      'bash',
      ['-c', 'set -euo pipefail; PATH=/nonexistent; FIREISP_LIB_ONLY=1 source "$1"; install_deploy_agent', 'bash', script],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).toMatch(/no systemctl/);
  });

  it('compares before writing, so an unchanged deploy does not churn systemd', () => {
    // Rewriting identical files every deploy would restart the timer for
    // nothing, on every single deploy.
    const src = require('node:fs').readFileSync(script, 'utf8');
    expect(src).toMatch(/if ! cmp -s "\$src" "\$dst"; then/);
    expect(src).toMatch(/if \(\( changed \)\); then\s*\n\s*systemctl daemon-reload/);
  });

  it('never lets a unit-install failure fail the deploy', () => {
    // Every branch returns 0. A deploy that succeeded must not be reported as
    // failed because a convenience feature could not be set up.
    const src = require('node:fs').readFileSync(script, 'utf8');
    const fn = src.slice(src.indexOf('install_deploy_agent() {'), src.indexOf('\n}', src.indexOf('install_deploy_agent() {')));
    expect(fn).not.toMatch(/exit 1/);
    expect((fn.match(/return 0/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
