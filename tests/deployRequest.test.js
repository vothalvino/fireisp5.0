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
  // EVERY negative assertion below must run against this, not the raw source.
  // This script documents the constructs it deliberately rejected, so a bare
  // "the file does not contain X" flags its own rationale — the same
  // substring-matches-prose trap that has now produced three phantom failures
  // in this feature's tests.
  const code = () => src().split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

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

  it('authenticates with the values compose gave the container, never a re-parse of .env.prod', () => {
    // The old grep|cut of DB_* out of .env.prod failed "Access denied" on any
    // format compose's dotenv parser accepts but a naive grep does not —
    // quoted values, an `export` prefix, CRLF endings, a duplicate key where
    // the later definition wins — on a box where the app itself was connecting
    // fine (live outage #2 of this feature). The container's MYSQL_* env IS
    // compose's parse of the same file, so app-can-connect implies
    // agent-can-connect by construction.
    const s = src();
    expect(s).toMatch(/-u "\$MYSQL_USER" "\$MYSQL_DATABASE"/);
    expect(s).toMatch(/MYSQL_PWD="\$MYSQL_PASSWORD"/);
    expect(s).not.toMatch(/grep -E '\^DB_/);
  });

  it('puts NOTHING sensitive in host argv — statement on stdin, credentials expanded in the container', () => {
    // /proc/<pid>/cmdline is mode 0444: every local user can read the argv of a
    // root process while it runs. An `exec -e SQL_STMT=...` form was tried and
    // is NOT equivalent — bash expands it into the argv of the HOST docker
    // process, exposing the whole statement including output_tail (registry
    // URLs, image digests, migration output from a root process).
    const s = src();
    expect(s).toMatch(/printf '%s' "\$1" \| dc exec -T "\$DB_SERVICE"/);
    expect(code()).not.toMatch(/-e SQL_STMT=/);
    // The container command is single-quoted, so the host shell expands neither
    // the credentials nor the statement.
    const cmd = s.split('\n').find((l) => l.includes('MYSQL_PWD='));
    expect(cmd).toBeDefined();
    expect(cmd.trim().startsWith("'MYSQL_PWD=")).toBe(true);
    // …and the statement never becomes an argument of mysql either.
    expect(cmd).not.toMatch(/-e "/);
  });

  it('never echoes raw database stderr, which can quote lines of .env.prod', () => {
    // compose is invoked with `--env-file <secrets file>` and its dotenv parser
    // quotes the offending source line back on a parse error. Echoing that into
    // the journal every 30s would hand DB_PASSWORD/ENCRYPTION_KEY to every
    // `adm`/`systemd-journal` member and any log shipper on the box.
    const s = src();
    const fallback = s.slice(s.indexOf('err_report() {'));
    const defaultArm = fallback.slice(fallback.indexOf('    *)'), fallback.indexOf('esac'));
    expect(defaultArm).not.toMatch(/\$\{?err/i); // the captured stderr is not interpolated
    expect(defaultArm).toMatch(/logs \$\{DB_SERVICE\}/); // a pointer instead
  });

  it('reports before exiting at every query, not just the heartbeat', () => {
    // A bare `set -e` exit left `journalctl -u fireisp-deploy-agent` — the
    // command the UI tells the operator to run — completely empty, while the
    // captured reason was deleted by the EXIT trap.
    const s = src();
    for (const site of ['claiming a request', 'reading the claimed request',
      'sweeping stale deploys', 're-checking the claim', 'writing the result of request']) {
      expect(s).toContain(`err_report "${site}`);
    }
  });

  it('does not announce success when the result was never written back', () => {
    // Five failed writes then "request N succeeded" would describe a row the
    // GUI never received: the UI sits on "running" while the journal says done.
    const s = src();
    expect(s).toMatch(/WROTE_RESULT=1/);
    expect(s).toMatch(/if \(\( WROTE_RESULT \)\); then/);
    expect(s).toMatch(/could NOT be written back/);
  });

  it('honours the opt-out itself, before writing a heartbeat', () => {
    // Covers the window where the flag is set but the host has not redeployed,
    // so redeploy has not yet disabled the timer. No heartbeat means the GUI
    // reports no agent and hides the button — what "off" should look like.
    const s = src();
    const guard = s.slice(0, s.indexOf('deploy_agent_status'));
    expect(guard).toMatch(/FIREISP_DEPLOY_AGENT/);
    expect(guard).toMatch(/0\|false\|no\|off\)/);
  });

  it('reports the real database error instead of guessing', () => {
    // The first version discarded stderr and printed "is the stack up?" while
    // mysql was answering "Access denied" — which sent the live diagnosis in
    // exactly the wrong direction.
    // The query's stderr is captured, never discarded — asserted on the sql()
    // function itself, since 2>/dev/null is legitimate elsewhere (reading an
    // optional file). Then it is classified for the journal.
    const s = src();
    const sqlFn = s.slice(s.indexOf('sql() {'), s.indexOf('err_report() {'));
    expect(sqlFn).toMatch(/2>"\$ERR_FILE"/);
    expect(sqlFn).not.toMatch(/2>\/dev\/null/);
    expect(s).toMatch(/Access denied/);
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
    expect(run('DEPLOY_AGENT=0;')).toMatch(/GUI deploys are off/);
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

  // A sandbox whose `systemctl` RECORDS instead of acting. Without it these
  // tests' only protection against touching the host's real systemd is the
  // feature under test working — so a regression in the flag parse would, on a
  // root shell or in the uid-0 test containers, enable a production timer as a
  // side effect of the test that exists to prove it does not.
  const sandbox = ({ env = '', timerInstalled = false } = {}) => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-agent-flag-'));
    fs.writeFileSync(path.join(dir, '.env.prod'), env);
    fs.mkdirSync(path.join(dir, 'bin'));
    const calls = path.join(dir, 'systemctl.calls');
    fs.writeFileSync(path.join(dir, 'bin', 'systemctl'),
      `#!/usr/bin/env bash\necho "$@" >> ${JSON.stringify(calls)}\n`
      // is-enabled/is-active decide whether a timer is considered present.
      + `case "$1" in is-enabled|is-active) exit ${timerInstalled ? 0 : 1} ;; esac\nexit 0\n`);
    fs.chmodSync(path.join(dir, 'bin', 'systemctl'), 0o755);
    // stderr merged into stdout: warnings are written to stderr, and
    // execFileSync's return value carries stdout only.
    const run = (extraEnv = {}) => require('node:child_process').execFileSync(
      'bash',
      ['-c', 'exec 2>&1; set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; install_deploy_agent', 'bash', script],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, FIREISP_DIR: dir, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { run, systemctlCalls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '') };
  };

  it('honours FIREISP_DEPLOY_AGENT=0 written in .env.prod — the one place sudo cannot strip it', () => {
    // The docs always pointed operators at .env.prod, but the script only read
    // the process environment — which sudoers' env_reset empties, so the
    // documented opt-out could never work. Quotes, a trailing comment and a CR
    // are all present here because hand-edited files have all three.
    const s = sandbox({ env: 'DB_PASSWORD=x\nFIREISP_DEPLOY_AGENT="0" # no timer on this box\r\n' });
    expect(s.run()).toMatch(/GUI deploys are off/);
    expect(s.systemctlCalls()).not.toMatch(/^enable --now/m);
  });

  it('STOPS a timer that is already installed, rather than just declining to install one', () => {
    // The units are installed by the first deploy that carries them, so by the
    // time an operator reads the docs and sets the flag the timer is already
    // enabled. "Skipping" left a root poller servicing GUI deploy requests on a
    // box whose operator had just been told GUI deploys were off.
    const s = sandbox({ env: 'FIREISP_DEPLOY_AGENT=0\n', timerInstalled: true });
    expect(s.run()).toMatch(/stopped and disabled/);
    expect(s.systemctlCalls()).toMatch(/^disable --now fireisp-deploy-agent\.timer$/m);
  });

  it.each([['false'], ['no'], ['off'], ['FALSE'], ['Off']])('reads %s as off, not as on', (value) => {
    const s = sandbox({ env: `FIREISP_DEPLOY_AGENT=${value}\n`, timerInstalled: true });
    expect(s.run()).toMatch(/stopped and disabled/);
    expect(s.systemctlCalls()).not.toMatch(/^enable --now/m);
  });

  it('WARNS on a value it does not recognise instead of silently enabling', () => {
    // Reading a typo as the default is right for FIREISP_UPDATE_CHECK, whose
    // default is an inert banner. It is wrong here: the default grants a root
    // timer the power to service GUI-initiated deploys, so an operator who
    // meant "off" must not be told nothing.
    const s = sandbox({ env: 'FIREISP_DEPLOY_AGENT=disabled\n' });
    const out = s.run();
    expect(out).toMatch(/not a recognised value/);
    expect(out).toMatch(/stays ENABLED/);
  });

  it('an environment value that genuinely survives still wins over the file', () => {
    const s = sandbox({ env: 'FIREISP_DEPLOY_AGENT=0\n', timerInstalled: true });
    const out = s.run({ FIREISP_DEPLOY_AGENT: '1' });
    expect(out).not.toMatch(/GUI deploys are off/);
    expect(s.systemctlCalls()).not.toMatch(/disable/);
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
