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
