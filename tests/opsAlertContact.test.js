'use strict';
// =============================================================================
// FireISP 5.0 — infrastructure alerts go to the ops contact (j31)
// =============================================================================
// TLS expiry alerts fanned out to the admins and managers of EVERY active
// organization, because the certificate serves the whole install. On a
// multi-tenant deployment that means every tenant admin receives host-level
// instructions ("run `docker compose logs certbot`") for a machine they have no
// shell on — noise they cannot act on, plus a small disclosure about how the
// platform is hosted.
//
// Migration 436 adds `ops_alert_email`. The two properties that matter:
//   * configured  -> delivered ONCE to that address, no per-org fan-out
//   * unset       -> the old fan-out, unchanged. An upgrade must never silently
//                    stop delivering to the only people currently receiving it.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../src/models/Notification', () => ({ create: jest.fn().mockResolvedValue({ id: 1 }) }));
jest.mock('../src/models/User', () => ({ getStaffByEffectiveRole: jest.fn() }));

const tlsSock = require('node:tls');
const config = require('../src/config');
const db = require('../src/config/database');
const emailTransport = require('../src/services/emailTransport');
const Notification = require('../src/models/Notification');
const User = require('../src/models/User');
const { opsAlertRecipients, hasOpsContact } = require('../src/services/opsContact');

const SETTINGS_Q = /FROM settings WHERE setting_key = 'ops_alert_email'/;
const CLAIM_Q = /INSERT IGNORE INTO ops_alert_deliveries/;

/** @param opsEmail '' for unset. @param claimed false when the alert already went out. */
function wireDb({ opsEmail = '', claimed = true, orgs = [{ id: 1 }, { id: 2 }] } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (SETTINGS_Q.test(sql)) return [opsEmail === null ? [] : [{ setting_value: opsEmail }]];
    if (CLAIM_Q.test(sql)) return [{ affectedRows: claimed ? 1 : 0 }];
    if (/FROM organizations/.test(sql)) return [orgs];
    if (/FROM notifications/.test(sql)) return [[]];      // nothing deduped yet
    return [[]];
  });
}

/** Fake a TLS peer certificate expiring `days` from now (same shape as tlsMonitorService.test.js). */
function stubPeerCert(days) {
  const validTo = new Date(Date.now() + days * 86_400_000);
  const socket = {
    getPeerCertificate: () => ({ valid_to: validTo.toUTCString(), issuer: { O: "Let's Encrypt" } }),
    authorized: true, authorizationError: null,
    end: jest.fn(), destroy: jest.fn(), on: jest.fn(),
  };
  return jest.spyOn(tlsSock, 'connect').mockImplementation((options, cb) => {
    setImmediate(cb);
    return socket;
  });
}

const originalAppUrl = config.appUrl;
afterEach(() => { config.appUrl = originalAppUrl; });

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  config.appUrl = 'https://isp.example.com';
  stubPeerCert(7);            // inside the alert threshold
  User.getStaffByEffectiveRole.mockResolvedValue([
    { id: 10, email: 'admin@tenant-one.example' },
    { id: 11, email: 'manager@tenant-one.example' },
  ]);
});

describe('resolving the contact', () => {
  it('splits a comma-separated list and trims', async () => {
    wireDb({ opsEmail: 'ops@isp.mx , noc@isp.mx' });
    expect(await opsAlertRecipients()).toEqual(['ops@isp.mx', 'noc@isp.mx']);
  });

  it('treats blank as UNSET, not as "send nowhere"', async () => {
    // The load-bearing default. If this returned something truthy, an upgrade
    // would silently stop alerting the only people currently receiving alerts.
    wireDb({ opsEmail: '' });
    expect(await opsAlertRecipients()).toEqual([]);
    expect(await hasOpsContact()).toBe(false);
  });

  it('treats a missing settings row as unset', async () => {
    wireDb({ opsEmail: null });
    expect(await hasOpsContact()).toBe(false);
  });

  it('drops junk entries rather than throwing and taking the alert with it', async () => {
    wireDb({ opsEmail: 'ops@isp.mx, not-an-address, ' });
    expect(await opsAlertRecipients()).toEqual(['ops@isp.mx']);
  });

  it('falls back when the settings read itself fails', async () => {
    db.query.mockRejectedValue(new Error('db down'));
    expect(await opsAlertRecipients()).toEqual([]);
  });
});

describe('with an ops contact configured', () => {
  const tls = () => require('../src/services/tlsMonitorService');

  it('emails the ops contact and does NOT page any tenant staff', async () => {
    wireDb({ opsEmail: 'ops@isp.mx' });
    await tls().checkTlsExpiry(null);

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@isp.mx' }),
    );
    // The whole point: tenant admins are not touched.
    expect(User.getStaffByEffectiveRole).not.toHaveBeenCalled();
    expect(Notification.create).not.toHaveBeenCalled();
  });

  it('delivers ONCE, not once per organization', async () => {
    wireDb({ opsEmail: 'ops@isp.mx', orgs: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await tls().checkTlsExpiry(null);
    expect(emailTransport.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not re-alert for a title already sent', async () => {
    // Dedupe is the INSERT IGNORE claim: affectedRows 0 means someone already
    // sent this exact alert. The daily task must not re-send every run.
    wireDb({ opsEmail: 'ops@isp.mx', claimed: false });
    await tls().checkTlsExpiry(null);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  it('releases the dedupe claim when nothing could be delivered', async () => {
    // Otherwise a transient SMTP outage suppresses the alert FOREVER — the
    // marker would outlive a send that never happened.
    wireDb({ opsEmail: 'ops@isp.mx' });
    emailTransport.sendEmail.mockRejectedValue(new Error('smtp down'));
    await tls().checkTlsExpiry(null);
    expect(db.query.mock.calls.some(([s]) => /DELETE FROM ops_alert_deliveries/.test(s))).toBe(true);
  });
});

describe('with NO ops contact — the old behaviour is untouched', () => {
  const tls = () => require('../src/services/tlsMonitorService');

  it('still fans out to each organization’s admins and managers', async () => {
    wireDb({ opsEmail: '' });
    await tls().checkTlsExpiry(null);

    expect(User.getStaffByEffectiveRole).toHaveBeenCalled();
    expect(Notification.create).toHaveBeenCalled();
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@tenant-one.example' }),
    );
  });
});
