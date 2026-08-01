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

describe('the answer stays FRESH enough to be useful', () => {
  // The bug this replaces: a 24h TTL meant the check ran exactly once per
  // deploy — at the moment the operator had just deployed HEAD, so the answer
  // was guaranteed to be "up to date" — and then froze. Anyone deploying more
  // often than daily would never once see an update reported.
  beforeEach(() => { process.env.FIREISP_GIT_SHA = RUNNING; });

  it('re-checks within a working session, not once a day', () => {
    expect(updateCheck.CHECK_TTL_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('notices commits that land after the first check', async () => {
    // Two steps, not one, since the check became non-blocking: the stale answer
    // is served instantly with refreshing=true, and the fresh one lands right
    // behind it. The client re-polls on that flag, so the operator still sees
    // the update without touching anything — that is what makes the tab both
    // fast AND accurate rather than trading one for the other.
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: RUNNING }) });
    expect((await updateCheck.getStatus()).update_available).toBe(false);

    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: LATEST }) });
    const realNow = Date.now;
    const base = realNow();
    Date.now = () => base + updateCheck.CHECK_TTL_MS + 1000;
    try {
      const first = await updateCheck.getStatus();
      expect(first.refreshing).toBe(true);          // tells the client to look again
      await new Promise((r) => setTimeout(r, 20));  // the refresh lands
      const second = await updateCheck.getStatus();
      expect(second.latest_sha).toBe(LATEST);
      expect(second.update_available).toBe(true);
    } finally { Date.now = realNow; }
  });

  it('does not claim to be refreshing when the answer is fresh', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: LATEST }) });
    await updateCheck.getStatus();
    expect((await updateCheck.getStatus()).refreshing).toBe(false);
  });

  it('holds a FAILURE far longer than an answer', async () => {
    // An air-gapped or egress-blocked install must not retry every 15 minutes
    // forever. Shortening both TTLs would have made a broken install noisier —
    // separating them is the actual fix.
    expect(updateCheck.FAILURE_TTL_MS).toBeGreaterThan(updateCheck.CHECK_TTL_MS * 4);
  });

  it('does not retry a failure at the success cadence', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND'));
    await updateCheck.getStatus();
    const realNow = Date.now;
    Date.now = () => realNow() + updateCheck.CHECK_TTL_MS + 1000;
    try {
      await updateCheck.getStatus();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally { Date.now = realNow; }
  });

  it('does retry a failure once its own window passes', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND'));
    await updateCheck.getStatus();
    const realNow = Date.now;
    Date.now = () => realNow() + updateCheck.FAILURE_TTL_MS + 1000;
    try {
      await updateCheck.getStatus();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally { Date.now = realNow; }
  });
});

describe('a page load never waits on GitHub', () => {
  // The Version tab was blocking on a round trip to api.github.com before it
  // could paint: ~300ms normally, and up to REQUEST_TIMEOUT_MS when GitHub is
  // slow, rate-limiting or unreachable from the host. With a 15-minute TTL and
  // someone visiting the tab occasionally, nearly EVERY visit was a cold one.
  beforeEach(() => { process.env.FIREISP_GIT_SHA = RUNNING; });

  it('serves the stale answer immediately once anything is cached', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: RUNNING }) });
    await updateCheck.getStatus();                       // populate

    // Make the network slow, and let the TTL lapse.
    fetchSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 250));
      return { ok: true, status: 200, json: async () => ({ sha: LATEST }) };
    });
    const realNow = Date.now;
    const base = realNow();
    Date.now = () => base + updateCheck.CHECK_TTL_MS + 1000;
    try {
      const started = realNow();
      const status = await updateCheck.getStatus();
      const elapsed = realNow() - started;
      expect(status.latest_sha).toBe(RUNNING);   // the stale value, served now
      expect(elapsed).toBeLessThan(100);         // did NOT wait for the 250ms call
    } finally { Date.now = realNow; }
  });

  it('picks up the refreshed value afterwards', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: RUNNING }) });
    await updateCheck.getStatus();

    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: LATEST }) });
    const realNow = Date.now;
    const base = realNow();
    Date.now = () => base + updateCheck.CHECK_TTL_MS + 1000;
    try {
      await updateCheck.getStatus();                       // triggers background refresh
      await new Promise((r) => setTimeout(r, 20));         // let it land
      expect((await updateCheck.getStatus()).latest_sha).toBe(LATEST);
    } finally { Date.now = realNow; }
  });

  it('the FIRST call of a process still waits — there is nothing to serve', async () => {
    // Returning null here would render "could not reach github.com" on a
    // perfectly healthy install. warmCache() moves this cost to boot.
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: LATEST }) });
    expect((await updateCheck.getStatus()).latest_sha).toBe(LATEST);
  });

  it('deduplicates concurrent callers into one request', async () => {
    // Several widgets mounting at once must not each hit GitHub.
    fetchSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, status: 200, json: async () => ({ sha: LATEST }) };
    });
    await Promise.all([updateCheck.getStatus(), updateCheck.getStatus(), updateCheck.getStatus()]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('warmCache', () => {
  it('populates the cache so the first visit is instant', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: LATEST }) });
    updateCheck.warmCache();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await updateCheck.getStatus()).latest_sha).toBe(LATEST);
    expect(fetchSpy).toHaveBeenCalledTimes(1);   // served from the warm cache
  });

  it('makes NO call when the operator has not enabled checks', async () => {
    // Boot must not make a network request they declined.
    process.env.FIREISP_UPDATE_CHECK = '0';
    updateCheck.warmCache();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws, so it cannot break boot', () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND'));
    expect(() => updateCheck.warmCache()).not.toThrow();
  });
});

describe('a FORCED check bypasses the cache', () => {
  // The passive answer is at most 15 minutes old, which is fine in the
  // background and not fine when the operator has deliberately come to the
  // Version tab and asked.
  beforeEach(() => { process.env.FIREISP_GIT_SHA = RUNNING; });

  it('sees a commit the cached answer missed', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: RUNNING }) });
    expect((await updateCheck.getStatus()).update_available).toBe(false);

    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sha: LATEST }) });
    expect((await updateCheck.getStatus()).update_available).toBe(false);          // cached
    expect((await updateCheck.getStatus({ force: true })).update_available).toBe(true);
  });

  it('holds a floor so a double-click is not a burst', async () => {
    // GitHub allows 60/hour unauthenticated. A stuck button must not spend it.
    await updateCheck.getStatus({ force: true });
    const after = fetchSpy.mock.calls.length;
    await updateCheck.getStatus({ force: true });
    await updateCheck.getStatus({ force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(after);
  });

  it('within the floor it still returns a real answer, not an error', async () => {
    // Serving a ten-second-old value is not a lie; refusing would be worse UX
    // than being marginally stale.
    await updateCheck.getStatus({ force: true });
    const status = await updateCheck.getStatus({ force: true });
    expect(status.latest_sha).toBe(LATEST);
  });

  it('forces again once the floor has passed', async () => {
    await updateCheck.getStatus({ force: true });
    const after = fetchSpy.mock.calls.length;
    const realNow = Date.now;
    Date.now = () => realNow() + updateCheck.MIN_FORCED_INTERVAL_MS + 1000;
    try {
      await updateCheck.getStatus({ force: true });
      expect(fetchSpy).toHaveBeenCalledTimes(after + 1);
    } finally { Date.now = realNow; }
  });

  it('does not force when the operator has not enabled checks at all', async () => {
    process.env.FIREISP_UPDATE_CHECK = '0';
    await updateCheck.getStatus({ force: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /system/version/check', () => {
  it('is install-operator only', async () => {
    wireUser(TENANT);
    const res = await asUser(TENANT)(request(app).post('/api/v1/system/version/check'));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a freshly-checked status for the operator', async () => {
    wireUser(ADMIN);
    const res = await asUser(ADMIN)(request(app).post('/api/v1/system/version/check'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ running_sha: RUNNING, latest_sha: LATEST });
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

  it('caches a 200 that carries no sha — the case that leaked', async () => {
    // GitHub rate-limiting, or an intercepting corporate/ISP TLS proxy, answers
    // 200 with a body that has no string `sha`. Both fields then ended up null
    // and the freshness guard — keyed on `latestSha || error` — read falsy, so
    // the outbound call repeated on EVERY request, forever. Reproduced against
    // the real module: 3 getStatus() calls made 3 requests.
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: 'API rate limit exceeded' }) });
    await updateCheck.getStatus();
    await updateCheck.getStatus();
    await updateCheck.getStatus();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reports no update when the response carried no sha', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const status = await updateCheck.getStatus();
    expect(status.latest_sha).toBeNull();
    expect(status.update_available).toBe(false);
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
