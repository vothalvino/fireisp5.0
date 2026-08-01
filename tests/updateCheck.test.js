'use strict';
// =============================================================================
// FireISP 5.0 — update availability check
// =============================================================================
// The security-relevant property here is NOT the banner. It is that a
// self-hosted install makes NO outbound request unless its operator explicitly
// opted in. Every "disabled" case therefore asserts that fetch was never
// called, not merely that the response said disabled — a version that reported
// check_enabled:false while still phoning home would pass the weaker assertion
// and be exactly the bug worth preventing.
//
// The opt-in is an env var, not a row in `settings`, because `settings` is
// install-wide but writable by any org admin through PUT /settings/:key
// (verified on a live install; filed separately). Storing it there would let a
// tenant switch on an outbound call the operator declined.
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
const updateCheck = require('../src/services/updateCheck');
const app = require('../src/app');

const RUNNING = 'a'.repeat(40);
const LATEST = 'b'.repeat(40);

const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };
const TENANT = { id: 2, email: 't@b.c', role: 'manager', status: 'active', organization_id: 1 };

const tokenFor = (u) => jwt.sign(
  { sub: u.id, email: u.email, role: u.role, orgId: 1 }, config.jwt.secret, { expiresIn: '1h' },
);
const asUser = (u) => (r) => r.set('Authorization', `Bearer ${tokenFor(u)}`);

function wireUser(u) {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[u]];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

let fetchSpy;
beforeEach(() => {
  jest.clearAllMocks();
  updateCheck._resetCache();
  delete process.env.FIREISP_UPDATE_CHECK;
  process.env.FIREISP_GIT_SHA = RUNNING;
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, json: async () => ({ sha: LATEST }),
  });
});
afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.FIREISP_GIT_SHA;
  delete process.env.FIREISP_UPDATE_CHECK;
});

describe('on by default, explicit opt-OUT', () => {
  it('checks when the flag is unset — a fresh install works with no config', async () => {
    const status = await updateCheck.getStatus();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(status.check_enabled).toBe(true);
  });

  it.each([['0'], ['false'], ['no'], ['off'], ['OFF'], ['  0  ']])(
    'makes NO network call for FIREISP_UPDATE_CHECK=%j', async (val) => {
      // The opt-out has to actually stop the request, not just report disabled.
      process.env.FIREISP_UPDATE_CHECK = val;
      await updateCheck.getStatus();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([['1'], ['true'], ['TRUE'], ['yes'], ['']])(
    'checks for FIREISP_UPDATE_CHECK=%j', async (val) => {
      process.env.FIREISP_UPDATE_CHECK = val;
      const status = await updateCheck.getStatus();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(status.check_enabled).toBe(true);
    },
  );

  it('reads an unrecognised value as the DEFAULT, not as off', async () => {
    // A typo must fail toward the documented default. Silently disabling a
    // feature on a typo leaves an operator unable to explain why it is dead.
    process.env.FIREISP_UPDATE_CHECK = 'ture';
    expect((await updateCheck.getStatus()).check_enabled).toBe(true);
  });

  it('still reports the running commit while disabled', async () => {
    // Knowing what you are running needs no network and must not be gated.
    process.env.FIREISP_UPDATE_CHECK = '0';
    const status = await updateCheck.getStatus();
    expect(status.running_sha).toBe(RUNNING);
    expect(status.check_enabled).toBe(false);
  });

  it('sends no identifying data', async () => {
    await updateCheck.getStatus();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/^https:\/\/api\.github\.com\//);
    expect(opts.body).toBeUndefined();
    expect(JSON.stringify(opts.headers)).not.toContain(RUNNING);
    expect(Object.keys(opts.headers)).not.toContain('Authorization');
  });
});

describe('update_available is only claimed when it is knowable', () => {

  it('true when the two commits differ', async () => {
    expect((await updateCheck.getStatus()).update_available).toBe(true);
  });

  it('false when they match', async () => {
    process.env.FIREISP_GIT_SHA = LATEST;
    expect((await updateCheck.getStatus()).update_available).toBe(false);
  });

  it('false when the running commit is unknown', async () => {
    // A locally-built image bakes no SHA. Claiming an update exists would send
    // the operator to redeploy on the strength of a comparison never made.
    delete process.env.FIREISP_GIT_SHA;
    const status = await updateCheck.getStatus();
    expect(status.running_sha).toBeNull();
    expect(status.update_available).toBe(false);
  });

  it('false, and does not throw, when GitHub is unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND'));
    const status = await updateCheck.getStatus();
    expect(status.update_available).toBe(false);
    expect(status.latest_sha).toBeNull();
  });

  it('false on a non-200 from GitHub (rate limit, outage)', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    expect((await updateCheck.getStatus()).update_available).toBe(false);
  });
});

describe('the upstream lookup is cached', () => {

  it('checks once across many calls', async () => {
    await updateCheck.getStatus();
    await updateCheck.getStatus();
    await updateCheck.getStatus();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caches FAILURES too, so an install with no egress does not retry per request', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND'));
    await updateCheck.getStatus();
    await updateCheck.getStatus();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GET /system/version is install-operator only', () => {
  it('404s for a tenant user — not 403, which would confirm it exists', async () => {
    wireUser(TENANT);
    const res = await asUser(TENANT)(request(app).get('/api/v1/system/version'));
    expect(res.status).toBe(404);
  });

  it('does not run the check for a tenant user', async () => {
    wireUser(TENANT);
    await asUser(TENANT)(request(app).get('/api/v1/system/version'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves the install operator', async () => {
    wireUser(ADMIN);
    const res = await asUser(ADMIN)(request(app).get('/api/v1/system/version'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      running_sha: RUNNING, latest_sha: LATEST, update_available: true, check_enabled: true,
    });
  });

  it('requires authentication', async () => {
    wireUser(ADMIN);
    const res = await request(app).get('/api/v1/system/version');
    expect([401, 403]).toContain(res.status);
  });
});
