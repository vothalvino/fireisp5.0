'use strict';
// =============================================================================
// FireISP 5.0 — TLS certificate expiry monitor
// =============================================================================
// Guards the behaviours that make this monitor worth having:
//   • it alerts BEFORE expiry, at 30/14/7 days, and again once expired
//   • it does NOT re-alert every daily run for the same threshold
//   • an unreachable host is reported, not thrown — a site outage must not mark
//     the scheduled task failed
//   • a plain-HTTP install is a quiet skip, not an error (that is the dev default)
//   • an ALREADY-EXPIRED certificate is still readable — the handshake must not
//     be verified, or the monitor goes blind exactly when it matters
// =============================================================================

const mockQuery = jest.fn();
const mockNotificationCreate = jest.fn().mockResolvedValue({ id: 1 });
const mockSendEmail = jest.fn().mockResolvedValue(undefined);
const mockGetStaff = jest.fn();

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../src/models/Notification', () => ({ create: mockNotificationCreate }));
jest.mock('../src/models/User', () => ({ getStaffByEffectiveRole: mockGetStaff }));
jest.mock('../src/services/emailTransport', () => ({ sendEmail: mockSendEmail }));

const tls = require('node:tls');
const config = require('../src/config');
const svc = require('../src/services/tlsMonitorService');

/** Fake a TLS peer certificate expiring `days` from now. */
function stubPeerCert(days, opts = {}) {
  const validTo = new Date(Date.now() + days * 86_400_000);
  const socket = {
    getPeerCertificate: () => ({ valid_to: validTo.toUTCString(), issuer: { O: "Let's Encrypt" } }),
    authorized: opts.authorized !== undefined ? opts.authorized : true,
    authorizationError: opts.authorizationError ?? null,
    end: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
  };
  return jest.spyOn(tls, 'connect').mockImplementation((options, cb) => {
    if (opts.captureOptions) opts.captureOptions(options);
    setImmediate(cb);
    return socket;
  });
}

const originalAppUrl = config.appUrl;

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  config.appUrl = 'https://isp.example.com';
  mockGetStaff.mockResolvedValue([{ id: 7, email: 'admin@isp.example.com' }]);
  // default: organizations lookup + "no duplicate notification yet"
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM organizations/i.test(sql)) return [[{ id: 1 }]];
    if (/FROM notifications/i.test(sql)) return [[]];
    return [[]];
  });
});
afterEach(() => { config.appUrl = originalAppUrl; });

describe('checkTlsExpiry — healthy certificate', () => {
  it('reports days left and alerts nobody when expiry is far away', async () => {
    stubPeerCert(90);
    const r = await svc.checkTlsExpiry(null);
    expect(r.checked).toBe(true);
    expect(r.days_left).toBeGreaterThan(60);
    expect(r.notifications_sent).toBe(0);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

describe('checkTlsExpiry — alert thresholds', () => {
  it.each([[30, 29], [14, 13], [7, 6]])(
    'alerts at the %i-day threshold', async (_threshold, days) => {
      stubPeerCert(days);
      const r = await svc.checkTlsExpiry(null);
      expect(r.notifications_sent).toBe(1);
      expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
      expect(mockNotificationCreate.mock.calls[0][0].type).toBe('warning');
    },
  );

  it('raises an ERROR-level alert once the certificate has expired', async () => {
    stubPeerCert(-3);
    const r = await svc.checkTlsExpiry(null);
    expect(r.days_left).toBeLessThanOrEqual(0);
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    const arg = mockNotificationCreate.mock.calls[0][0];
    expect(arg.type).toBe('error');
    expect(arg.title).toMatch(/EXPIRED/);
  });

  it('emails the recipients as well as ringing the bell', async () => {
    stubPeerCert(5);
    await svc.checkTlsExpiry(null);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe('admin@isp.example.com');
  });
});

describe('checkTlsExpiry — does not nag', () => {
  it('sends nothing when the same alert already exists for that user', async () => {
    stubPeerCert(6);
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM organizations/i.test(sql)) return [[{ id: 1 }]];
      if (/FROM notifications/i.test(sql)) return [[{ id: 99 }]];   // already alerted
      return [[]];
    });
    const r = await svc.checkTlsExpiry(null);
    expect(r.notifications_sent).toBe(0);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

describe('checkTlsExpiry — failure modes are reported, not thrown', () => {
  it('returns an error result when the host is unreachable', async () => {
    jest.spyOn(tls, 'connect').mockImplementation(() => {
      const s = { end: jest.fn(), destroy: jest.fn(), on: (ev, cb) => { if (ev === 'error') setImmediate(() => cb(new Error('ECONNREFUSED'))); } };
      return s;
    });
    const r = await svc.checkTlsExpiry(null);
    expect(r.checked).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it('quietly skips a plain-HTTP install (the dev default)', async () => {
    config.appUrl = 'http://localhost:3000';
    const spy = jest.spyOn(tls, 'connect');
    const r = await svc.checkTlsExpiry(null);
    expect(r.skipped).toMatch(/no TLS certificate/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips an unparseable APP_URL without throwing', async () => {
    config.appUrl = 'not a url';
    const r = await svc.checkTlsExpiry(null);
    expect(r.skipped).toMatch(/not a valid URL/);
  });
});

describe('checkTlsExpiry — reads an invalid certificate on purpose', () => {
  it('does NOT verify the handshake, or an expired cert could never be read', async () => {
    let opts;
    stubPeerCert(-1, { captureOptions: (o) => { opts = o; } });
    await svc.checkTlsExpiry(null);
    // The whole point: a validating handshake throws on an expired certificate,
    // so the monitor would go blind in exactly the case it exists to catch.
    expect(opts.rejectUnauthorized).toBe(false);
    expect(opts.servername).toBe('isp.example.com');
  });

  it('defaults to port 443 and honours an explicit port', async () => {
    let opts;
    stubPeerCert(40, { captureOptions: (o) => { opts = o; } });
    await svc.checkTlsExpiry(null);
    expect(opts.port).toBe(443);

    config.appUrl = 'https://isp.example.com:8443';
    stubPeerCert(40, { captureOptions: (o) => { opts = o; } });
    await svc.checkTlsExpiry(null);
    expect(opts.port).toBe(8443);
  });
});

describe('checkTlsExpiry — alert has recipients', () => {
  it('logs loudly and sends nothing when an org has no admin or manager', async () => {
    stubPeerCert(5);
    mockGetStaff.mockResolvedValue([]);
    const r = await svc.checkTlsExpiry(null);
    expect(r.notifications_sent).toBe(0);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

describe('the dedupe key rotates with the certificate', () => {
  // THE defect the review caught: with only threshold+hostname in the title, the
  // first alert created a permanent row (notifications are never purged — no
  // delete route, and retentionService does not cover the table), so every later
  // alert for a NEW certificate matched it and was suppressed. The monitor
  // became a one-shot alarm — the same silent failure it exists to prevent.
  it('puts the certificate expiry date in the title', async () => {
    stubPeerCert(6);
    await svc.checkTlsExpiry(null);
    const title = mockNotificationCreate.mock.calls[0][0].title;
    const expected = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    expect(title).toContain(expected);
  });

  it('two DIFFERENT certificates at the SAME threshold get different keys', async () => {
    // This is the property that makes the monitor repeatable. If both renewals
    // produced the same title, the second alert would match the first's row and
    // be suppressed — silently, forever.
    stubPeerCert(6);                            // one cert, 6 days out
    await svc.checkTlsExpiry(null);
    const firstTitle = mockNotificationCreate.mock.calls[0][0].title;

    jest.clearAllMocks();
    stubPeerCert(5);                            // still the 7-day threshold, different cert
    await svc.checkTlsExpiry(null);
    const secondTitle = mockNotificationCreate.mock.calls[0][0].title;

    expect(secondTitle).not.toBe(firstTitle);
    expect(firstTitle).toMatch(/≤7 days/);      // same threshold in both...
    expect(secondTitle).toMatch(/≤7 days/);     // ...so only the DATE distinguishes them
  });
});

describe('a certificate can be untrustworthy without being expired', () => {
  it('alerts when verification fails for a NON-expiry reason', async () => {
    stubPeerCert(60, { authorized: false, authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    const r = await svc.checkTlsExpiry(null);
    expect(r.authorized).toBe(false);
    expect(r.notifications_sent).toBe(1);
    const arg = mockNotificationCreate.mock.calls[0][0];
    expect(arg.type).toBe('error');
    expect(arg.title).toMatch(/not trusted/i);
  });

  it('does NOT double-alert when the failure is simply that it expired', async () => {
    stubPeerCert(-2, { authorized: false, authorizationError: 'CERT_HAS_EXPIRED' });
    const r = await svc.checkTlsExpiry(null);
    // one alert, the expiry one — not an extra "not trusted" alert saying the same thing
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockNotificationCreate.mock.calls[0][0].title).toMatch(/EXPIRED/);
    expect(r.notifications_sent).toBe(1);
  });

  it('a valid, trusted certificate raises nothing', async () => {
    stubPeerCert(60, { authorized: true });
    const r = await svc.checkTlsExpiry(null);
    expect(r.notifications_sent).toBe(0);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

describe('fan-out targets only organizations that can act', () => {
  it('queries active, non-deleted organizations only', async () => {
    stubPeerCert(5);
    await svc.checkTlsExpiry(null);
    const orgQuery = mockQuery.mock.calls.map(c => c[0]).find(q => /FROM organizations/i.test(q));
    expect(orgQuery).toMatch(/status = 'active'/);
    expect(orgQuery).toMatch(/deleted_at IS NULL/);
  });
});

describe('counting is honest', () => {
  it('does not count a recipient whose bell failed to persist', async () => {
    stubPeerCert(5);
    mockNotificationCreate.mockRejectedValueOnce(new Error('db down'));
    const r = await svc.checkTlsExpiry(null);
    // the row never persisted, so it is also not a dedupe marker — next run retries
    expect(r.notifications_sent).toBe(0);
  });
});

describe('remediation text is install-agnostic', () => {
  it('does not name a container that only exists under one compose project name', async () => {
    stubPeerCert(5);
    await svc.checkTlsExpiry(null);
    const body = mockNotificationCreate.mock.calls[0][0].body;
    expect(body).not.toMatch(/docker logs fireisp-certbot/);
    expect(body).toMatch(/docker compose/);
  });
});

// ===========================================================================
// A monitor that cannot check anything must SAY SO (j30)
// ===========================================================================
// checkTlsExpiry returned { checked: false, error } when it could not reach the
// endpoint and nothing escalated it. An install that can never reach its own
// hostname — load balancer, split-horizon DNS, APP_URL not matching the
// certificate SAN, a WAF — reported a clean run forever and never alerted.
// The same silent failure the monitor exists to prevent, one level up.
describe('checkTlsExpiry — the check itself failing', () => {
  /** @param state what tls_monitor_state currently holds */
  function wireState(state) {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM organizations/i.test(sql)) return [[{ id: 1 }]];
      if (/FROM notifications/i.test(sql)) return [[]];
      if (/FROM tls_monitor_state/i.test(sql)) return [[state]];
      return [[]];
    });
  }
  const unreachable = () => jest.spyOn(tls, 'connect').mockImplementation(() => {
    throw new Error('ETIMEDOUT');
  });

  it('records the failure and increments the streak', async () => {
    wireState({ last_success_at: new Date().toISOString(), consecutive_failures: 1 });
    unreachable();
    const r = await svc.checkTlsExpiry(null);
    expect(r.checked).toBe(false);
    const upd = mockQuery.mock.calls.find(c => /UPDATE tls_monitor_state/i.test(c[0]) && /last_failure_at/.test(c[0]));
    expect(upd).toBeDefined();
    expect(upd[0]).toMatch(/consecutive_failures = consecutive_failures \+ 1/);
  });

  it('stays QUIET while the failure is recent — an outage is not an alarm', async () => {
    // Succeeded an hour ago: one blip must not page anyone.
    wireState({ last_success_at: new Date(Date.now() - 3600_000).toISOString(), consecutive_failures: 1 });
    unreachable();
    const r = await svc.checkTlsExpiry(null);
    expect(r.notifications_sent).toBe(0);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it('ALERTS once the check has not succeeded for a day', async () => {
    wireState({ last_success_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), consecutive_failures: 8 });
    unreachable();
    const r = await svc.checkTlsExpiry(null);
    expect(r.notifications_sent).toBe(1);
    const n = mockNotificationCreate.mock.calls[0][0];
    expect(n.type).toBe('error');
    // The operator must learn the REAL consequence, not just "a check failed".
    expect(n.body).toMatch(/NOTHING is currently watching that certificate/);
    expect(n.body).toMatch(/ETIMEDOUT/);
  });

  it('escalates: the milestone is in the TITLE so a longer outage alerts again', async () => {
    // The title is the dedupe key. Without the milestone, the first alert would
    // suppress every escalation — the alarm about a silent monitor going silent.
    wireState({ last_success_at: new Date(Date.now() - 9 * 86_400_000).toISOString(), consecutive_failures: 40 });
    unreachable();
    await svc.checkTlsExpiry(null);
    expect(mockNotificationCreate.mock.calls[0][0].title).toMatch(/not succeeded for 7\+ days/);
  });

  it('a NEVER-succeeded install waits for 3 attempts before crying wolf', async () => {
    wireState({ last_success_at: null, consecutive_failures: 1 });
    unreachable();
    expect((await svc.checkTlsExpiry(null)).notifications_sent).toBe(0);

    jest.clearAllMocks();
    wireState({ last_success_at: null, consecutive_failures: 3 });
    unreachable();
    const r = await svc.checkTlsExpiry(null);
    expect(r.notifications_sent).toBe(1);
    expect(mockNotificationCreate.mock.calls[0][0].body).toMatch(/never succeeded/);
  });

  it('an unreadable certificate counts as a failure, not a quiet return', async () => {
    // Reached the host but valid_to is garbage — still nothing watching it.
    wireState({ last_success_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), consecutive_failures: 20 });
    jest.spyOn(tls, 'connect').mockImplementation((options, cb) => {
      setImmediate(cb);
      return {
        getPeerCertificate: () => ({ valid_to: 'not-a-date', issuer: {} }),
        authorized: true, authorizationError: null,
        end: jest.fn(), destroy: jest.fn(), on: jest.fn(),
      };
    });
    const r = await svc.checkTlsExpiry(null);
    expect(r.checked).toBe(false);
    expect(r.notifications_sent).toBe(1);
  });

  it('a successful read CLEARS the streak', async () => {
    wireState({ last_success_at: null, consecutive_failures: 9 });
    stubPeerCert(90);
    await svc.checkTlsExpiry(null);
    const upd = mockQuery.mock.calls.find(c => /UPDATE tls_monitor_state/i.test(c[0]) && /consecutive_failures = 0/.test(c[0]));
    expect(upd).toBeDefined();
  });

  it('bookkeeping failure never turns a healthy check into a failed task', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/tls_monitor_state/i.test(sql)) throw new Error('table missing');
      if (/FROM organizations/i.test(sql)) return [[{ id: 1 }]];
      if (/FROM notifications/i.test(sql)) return [[]];
      return [[]];
    });
    stubPeerCert(90);
    const r = await svc.checkTlsExpiry(null);
    expect(r.checked).toBe(true);
    expect(r.days_left).toBeGreaterThan(60);
  });
});
