// =============================================================================
// FireISP 5.0 — Email Transport Service Unit Tests
// =============================================================================
// NOTE: emailTransport.js keeps a module-level singleton `transporter` for
// the global relay, lazily created by init() and NEVER recreated afterwards.
// Every "global transport" test below therefore shares the SAME sendMail
// mock (`mockSendMail`, declared once) — mirrors the pre-existing structure
// of this file. Per-org settings are authoritatively re-read for every send.
// A transport may be reused only while the full settings fingerprint is
// unchanged, so org-specific tests use a fresh id for each cache scenario.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/models/EmailSettings', () => ({
  findRawByOrgId: jest.fn(),
}));

jest.mock('../src/utils/encryption', () => ({
  encrypt: (v) => `enc:${v}`,
  decrypt: (v) => (typeof v === 'string' ? v.replace('enc:', '') : v),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const nodemailer = require('nodemailer');
const db = require('../src/config/database');
const EmailSettings = require('../src/models/EmailSettings');
const emailTransport = require('../src/services/emailTransport');

describe('emailTransport', () => {
  const TRAP_DELIVERY_CLAIM_LEASE_MS = 5 * 60 * 1000;

  function expectBoundedSmtpTransport(options) {
    for (const field of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
      expect(options[field]).toEqual(expect.any(Number));
      expect(options[field]).toBeGreaterThan(0);
      expect(options[field]).toBeLessThan(TRAP_DELIVERY_CLAIM_LEASE_MS);
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    nodemailer.createTransport.mockImplementation(() => ({ sendMail: mockSendMail }));
  });

  // =========================================================================
  // sendEmail — global transport (no org config, or org has none)
  // =========================================================================
  describe('sendEmail() — global transport', () => {
    test('global SMTP cannot outlive the trap-delivery claim lease', () => {
      emailTransport.init();

      expectBoundedSmtpTransport(nodemailer.createTransport.mock.calls.at(-1)[0]);
    });

    test('sends email and logs success', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce(null); // no org config -> fall back to global
      mockSendMail.mockResolvedValueOnce({ messageId: '<abc@test>' });
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      const result = await emailTransport.sendEmail({
        organizationId: 42,
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(result).toEqual({ success: true, messageId: '<abc@test>' });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO email_logs'),
        expect.arrayContaining(['user@example.com', 'Test']),
      );
    });

    test.each([
      '127.0.0.1',
      '169.254.169.254',
      'rebind.tenant-controlled.example',
    ])('install-only Trap email never reads or constructs tenant SMTP target %s', async (smtpHost) => {
      emailTransport.init();
      const transportCount = nodemailer.createTransport.mock.calls.length;
      EmailSettings.findRawByOrgId.mockResolvedValue({
        organization_id: 4200,
        enabled: 1,
        smtp_host: smtpHost,
        smtp_port: 25,
        smtp_user: 'TENANT_SMTP_SENTINEL',
        smtp_password_encrypted: 'enc:TENANT_SMTP_PASSWORD_SENTINEL',
      });
      mockSendMail.mockResolvedValueOnce({ messageId: '<install-relay@test>' });
      db.query.mockResolvedValueOnce([{ insertId: 4200 }]);

      await expect(emailTransport.sendEmail({
        organizationId: 4200,
        emailFunction: 'noc',
        to: 'noc@example.com',
        subject: 'Trap forwarding',
        text: 'privacy-minimal trap',
        installTransportOnly: true,
        sanitizeFailure: true,
      })).resolves.toEqual({ success: true, messageId: '<install-relay@test>' });

      expect(EmailSettings.findRawByOrgId).not.toHaveBeenCalled();
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(transportCount);
      expect(JSON.stringify(nodemailer.createTransport.mock.calls)).not.toContain(smtpHost);
      expect(JSON.stringify(mockSendMail.mock.calls)).not.toMatch(/TENANT_SMTP_SENTINEL/);
    });

    test('sanitized Trap SMTP failure never persists raw socket details or codes', async () => {
      emailTransport.init();
      const sentinel = 'ECONNREFUSED 127.0.0.1:25 TENANT_SOCKET_SENTINEL';
      mockSendMail.mockRejectedValueOnce(Object.assign(new Error(sentinel), {
        code: 'ECONNREFUSED',
        address: '127.0.0.1',
        port: 25,
      }));
      db.query.mockResolvedValueOnce([{ insertId: 4201 }]);

      await expect(emailTransport.sendEmail({
        organizationId: 4201,
        to: 'noc@example.com',
        subject: 'Trap forwarding',
        text: 'test',
        installTransportOnly: true,
        sanitizeFailure: true,
      })).resolves.toEqual({ success: false, error: 'Email delivery failed.' });

      expect(JSON.stringify(db.query.mock.calls)).not.toContain(sentinel);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("'failed'"),
        expect.arrayContaining(['Email delivery failed.']),
      );
    });

    test('install-only timeout closes the active global relay even with an organization ID', async () => {
      jest.useFakeTimers();
      const close = jest.fn();
      const neverSettles = jest.fn(() => new Promise(() => {}));
      try {
        nodemailer.createTransport.mockReturnValueOnce({ sendMail: neverSettles, close });
        emailTransport.init();
        db.query.mockResolvedValueOnce([{ insertId: 4202 }]);

        const send = emailTransport.sendEmail({
          organizationId: 4202,
          to: 'noc@example.com',
          subject: 'Bounded install relay',
          text: 'test',
          absoluteTimeoutMs: 1000,
          installTransportOnly: true,
          sanitizeFailure: true,
        });
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1000);

        await expect(send).resolves.toEqual({
          success: false,
          error: 'Email delivery failed.',
          code: 'EMAIL_DELIVERY_TIMEOUT',
        });
        expect(EmailSettings.findRawByOrgId).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    test('logs failure when sendMail rejects', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce(null);
      mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
      db.query.mockResolvedValueOnce([{ insertId: 2 }]);

      const result = await emailTransport.sendEmail({
        organizationId: 43,
        to: 'bad@example.com',
        subject: 'Fail',
        html: '<p>Oops</p>',
      });

      expect(result).toEqual({ success: false, error: 'SMTP connection refused' });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("'failed'"),
        expect.arrayContaining(['SMTP connection refused']),
      );
    });

    test('a never-settling SMTP send is aborted by an absolute deadline before the claim lease', async () => {
      jest.useFakeTimers();
      const close = jest.fn();
      const neverSettles = jest.fn(() => new Promise(() => {}));
      try {
        EmailSettings.findRawByOrgId.mockResolvedValueOnce({
          organization_id: 9099,
          enabled: 1,
          smtp_host: 'smtp.deadline.example',
          smtp_port: 587,
          smtp_secure: 0,
          smtp_user: 'deadline-user',
          smtp_password_encrypted: 'enc:deadline-password',
          from_email: 'noc@example.com',
        });
        nodemailer.createTransport.mockReturnValueOnce({ sendMail: neverSettles, close });
        db.query.mockResolvedValueOnce([{ insertId: 99 }]);

        const send = emailTransport.sendEmail({
          organizationId: 9099,
          emailFunction: 'noc',
          to: 'operator@example.com',
          subject: 'Bounded trap delivery',
          text: 'test',
          absoluteTimeoutMs: 1000,
        });
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1000);

        await expect(send).resolves.toEqual({
          success: false,
          error: 'Email delivery exceeded its absolute deadline.',
          code: 'EMAIL_DELIVERY_TIMEOUT',
        });
        expect(neverSettles).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalled();
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining("'failed'"),
          expect.arrayContaining(['Email delivery exceeded its absolute deadline.']),
        );
        expect(1000).toBeLessThan(TRAP_DELIVERY_CLAIM_LEASE_MS);
      } finally {
        jest.useRealTimers();
      }
    });

    test('writes organization_id/client_id to email_logs when provided', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce(null);
      mockSendMail.mockResolvedValueOnce({ messageId: '<x@test>' });
      db.query.mockResolvedValueOnce([{ insertId: 3 }]);

      await emailTransport.sendEmail({
        organizationId: 44,
        clientId: 7,
        to: 'c@example.com',
        subject: 'With client',
        html: '<p>hi</p>',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO email_logs'),
        expect.arrayContaining(['c@example.com', 'With client', 44, 7]),
      );
    });

    test('sends without an org lookup at all when organizationId is not provided', async () => {
      mockSendMail.mockResolvedValueOnce({ messageId: '<noorg@test>' });
      db.query.mockResolvedValueOnce([{ insertId: 4 }]);

      const result = await emailTransport.sendEmail({
        to: 'noorg@example.com',
        subject: 'No org',
        html: '<p>hi</p>',
      });

      expect(result.success).toBe(true);
      expect(EmailSettings.findRawByOrgId).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getOrgTransport() / invalidateOrgTransport()
  // =========================================================================
  describe('getOrgTransport()', () => {
    test('returns null (fall back to global) when the org has no config row', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce(null);
      const result = await emailTransport.getOrgTransport(501);
      expect(result).toBeNull();
    });

    test('returns null when the org config is disabled', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce({
        organization_id: 502, enabled: 0, smtp_host: 'smtp.example.com',
      });
      const result = await emailTransport.getOrgTransport(502);
      expect(result).toBeNull();
    });

    test('returns null when the org config has no smtp_host', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce({
        organization_id: 503, enabled: 1, smtp_host: null,
      });
      const result = await emailTransport.getOrgTransport(503);
      expect(result).toBeNull();
    });

    test('builds a transporter with decrypted credentials when the org has an enabled config', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce({
        organization_id: 504, enabled: 1, smtp_host: 'smtp.org504.com', smtp_port: 2525,
        smtp_secure: 1, smtp_user: 'orguser', smtp_password_encrypted: 'enc:orgpass',
        from_email: 'noreply@org504.com', from_name: 'Org 504',
      });

      const result = await emailTransport.getOrgTransport(504);

      expect(result).not.toBeNull();
      expect(result.from).toBe('Org 504 <noreply@org504.com>');
      expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.org504.com',
        port: 2525,
        secure: true,
        auth: { user: 'orguser', pass: 'orgpass' },
      }));
      expectBoundedSmtpTransport(nodemailer.createTransport.mock.calls.at(-1)[0]);
    });

    test('re-reads authoritative settings but reuses the transport when the fingerprint is unchanged', async () => {
      const settings = {
        organization_id: 505, enabled: 1, smtp_host: 'smtp.org505.com', smtp_user: 'u',
        smtp_password_encrypted: 'enc:p',
      };
      EmailSettings.findRawByOrgId.mockResolvedValue(settings);

      const first = await emailTransport.getOrgTransport(505);
      const second = await emailTransport.getOrgTransport(505);

      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledTimes(2);
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    test('re-reads missing config so a remote enable can take effect on the next call', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValue(null);

      await emailTransport.getOrgTransport(506);
      await emailTransport.getOrgTransport(506);

      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledTimes(2);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    test('a settings rotation on another replica replaces and closes the stale cached transport', async () => {
      let settings = {
        organization_id: 508,
        enabled: 1,
        smtp_host: 'old.smtp.example',
        smtp_user: 'old-user',
        smtp_password_encrypted: 'enc:old-password',
      };
      EmailSettings.findRawByOrgId.mockImplementation(() => Promise.resolve(settings));
      const oldTransport = { sendMail: jest.fn(), close: jest.fn() };
      const newTransport = { sendMail: jest.fn(), close: jest.fn() };
      nodemailer.createTransport
        .mockReturnValueOnce(oldTransport)
        .mockReturnValueOnce(newTransport);

      const first = await emailTransport.getOrgTransport(508);
      settings = {
        ...settings,
        smtp_host: 'new.smtp.example',
        smtp_user: 'new-user',
        smtp_password_encrypted: 'enc:new-password',
      };
      const second = await emailTransport.getOrgTransport(508);

      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledTimes(2);
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
      expect(nodemailer.createTransport.mock.calls[1][0]).toMatchObject({
        host: 'new.smtp.example',
        auth: { user: 'new-user', pass: 'new-password' },
      });
      expect(first.transporter).toBe(oldTransport);
      expect(second.transporter).toBe(newTransport);
      expect(oldTransport.close).toHaveBeenCalledTimes(1);
    });

    test('invalidateOrgTransport() clears the cache entry so the next call re-queries', async () => {
      EmailSettings.findRawByOrgId
        .mockResolvedValueOnce({ organization_id: 507, enabled: 1, smtp_host: 'a.com', smtp_user: 'u', smtp_password_encrypted: 'enc:p' })
        .mockResolvedValueOnce(null);

      await emailTransport.getOrgTransport(507);
      emailTransport.invalidateOrgTransport(507);
      const second = await emailTransport.getOrgTransport(507);

      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledTimes(2);
      expect(second).toBeNull();
    });
  });

  // =========================================================================
  // getOrgTransport() — per-function identities (migration 407)
  // =========================================================================
  describe('getOrgTransport() — per-function', () => {
    test('uses the function-specific identity when it is configured', async () => {
      EmailSettings.findRawByOrgId.mockImplementation((orgId, fn) => {
        if (orgId === 701 && fn === 'billing') {
          return Promise.resolve({
            organization_id: 701, email_function: 'billing', enabled: 1,
            smtp_host: 'billing.smtp', smtp_user: 'bu', smtp_password_encrypted: 'enc:bp',
            from_email: 'billing@org.com', from_name: 'Billing',
          });
        }
        return Promise.resolve(null);
      });

      const result = await emailTransport.getOrgTransport(701, 'billing');
      expect(result.from).toBe('Billing <billing@org.com>');
      expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'billing.smtp' }));
    });

    test('falls back to the general identity when the function is unconfigured', async () => {
      EmailSettings.findRawByOrgId.mockImplementation((orgId, fn) => {
        if (orgId === 702 && fn === 'general') {
          return Promise.resolve({
            organization_id: 702, email_function: 'general', enabled: 1,
            smtp_host: 'general.smtp', smtp_user: 'gu', smtp_password_encrypted: 'enc:gp',
            from_email: 'general@org.com',
          });
        }
        return Promise.resolve(null); // billing has no row
      });

      const result = await emailTransport.getOrgTransport(702, 'billing');
      expect(result.from).toBe('general@org.com');
      expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'general.smtp' }));
      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledWith(702, 'billing');
      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledWith(702, 'general');
    });

    test('returns null (global) when neither the function nor general is configured', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValue(null);
      const result = await emailTransport.getOrgTransport(703, 'noc');
      expect(result).toBeNull();
    });

    test('invalidateOrgTransport clears EVERY function so a general change re-resolves inheritors', async () => {
      EmailSettings.findRawByOrgId.mockImplementation((orgId, fn) => {
        if (orgId === 705 && fn === 'general') {
          return Promise.resolve({
            organization_id: 705, email_function: 'general', enabled: 1,
            smtp_host: 'g705.smtp', smtp_user: 'u', smtp_password_encrypted: 'enc:p', from_email: 'g@705.com',
          });
        }
        return Promise.resolve(null);
      });

      await emailTransport.getOrgTransport(705, 'billing'); // caches billing (inherits general)
      await emailTransport.getOrgTransport(705, 'general'); // caches general
      const callsBefore = EmailSettings.findRawByOrgId.mock.calls.length;

      emailTransport.invalidateOrgTransport(705);

      await emailTransport.getOrgTransport(705, 'billing'); // must re-query, not serve stale
      expect(EmailSettings.findRawByOrgId.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // =========================================================================
  // sendEmail() — org-aware routing
  // =========================================================================
  describe('sendEmail() — org transport', () => {
    test('uses the org transporter (not the global one) when the org has an enabled config', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce({
        organization_id: 601, enabled: 1, smtp_host: 'smtp.org601.com', smtp_user: 'u601',
        smtp_password_encrypted: 'enc:p601', from_email: 'noreply@org601.com',
      });
      const orgSendMail = jest.fn().mockResolvedValueOnce({ messageId: '<org601@test>' });
      nodemailer.createTransport.mockReturnValueOnce({ sendMail: orgSendMail });
      db.query.mockResolvedValue([{ insertId: 1 }]);

      const result = await emailTransport.sendEmail({
        organizationId: 601,
        to: 'dest@example.com',
        subject: 'Org routed',
        html: '<p>hi</p>',
      });

      expect(result.success).toBe(true);
      expect(orgSendMail).toHaveBeenCalledTimes(1);
      expect(orgSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'noreply@org601.com',
        to: 'dest@example.com',
      }));
      // The global relay's sendMail (shared mockSendMail) was never touched.
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    test('a disable committed by another replica stops using the cached org SMTP on the next send', async () => {
      // Establish a known global fallback independently of earlier test order.
      emailTransport.init();
      let settings = {
        organization_id: 606,
        enabled: 1,
        smtp_host: 'old.smtp.org606.example',
        smtp_user: 'old-user',
        smtp_password_encrypted: 'enc:old-password',
        from_email: 'old@org606.example',
      };
      EmailSettings.findRawByOrgId.mockImplementation(() => Promise.resolve(settings));
      const oldOrgSend = jest.fn().mockResolvedValue({ messageId: '<old-org@test>' });
      const oldClose = jest.fn();
      nodemailer.createTransport.mockReturnValueOnce({ sendMail: oldOrgSend, close: oldClose });
      mockSendMail.mockResolvedValue({ messageId: '<global@test>' });
      db.query.mockResolvedValue([{ insertId: 1 }]);

      await emailTransport.sendEmail({
        organizationId: 606,
        to: 'first@example.com',
        subject: 'Before remote disable',
        text: 'first',
      });
      settings = { ...settings, enabled: 0 };
      await emailTransport.sendEmail({
        organizationId: 606,
        to: 'second@example.com',
        subject: 'After remote disable',
        text: 'second',
      });

      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledTimes(2);
      expect(oldOrgSend).toHaveBeenCalledTimes(1);
      expect(oldOrgSend).toHaveBeenCalledWith(expect.objectContaining({
        to: 'first@example.com',
      }));
      expect(oldClose).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'second@example.com',
      }));
    });

    test('routes through the function identity when emailFunction is passed', async () => {
      EmailSettings.findRawByOrgId.mockImplementation((orgId, fn) => {
        if (orgId === 704 && fn === 'billing') {
          return Promise.resolve({
            organization_id: 704, email_function: 'billing', enabled: 1,
            smtp_host: 'billing.org704.com', smtp_user: 'u', smtp_password_encrypted: 'enc:p',
            from_email: 'billing@org704.com',
          });
        }
        return Promise.resolve(null);
      });
      const billingSendMail = jest.fn().mockResolvedValueOnce({ messageId: '<b@test>' });
      nodemailer.createTransport.mockReturnValueOnce({ sendMail: billingSendMail });
      db.query.mockResolvedValue([{ insertId: 1 }]);

      const result = await emailTransport.sendEmail({
        organizationId: 704, emailFunction: 'billing',
        to: 'client@example.com', subject: 'Invoice', html: '<p>due</p>',
      });

      expect(result.success).toBe(true);
      expect(billingSendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'billing@org704.com' }));
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // processQueue
  // =========================================================================
  describe('processQueue()', () => {
    test('processes queued emails and returns counts', async () => {
      // email_logs.body is the real schema column (single field, not body_html/body_text)
      const entry = { id: 10, recipient: 'q@test.com', subject: 'Queued', body: '<p>Hi</p>' };
      db.query
        .mockResolvedValueOnce([[entry]])        // SELECT queued
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE sent
      mockSendMail.mockResolvedValueOnce({ messageId: '<q1@test>' });

      const result = await emailTransport.processQueue();
      expect(result).toEqual({ sent: 1, failed: 0, total: 1 });
      // Verify sendMail receives the body from the real column
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        html: '<p>Hi</p>',
        text: '<p>Hi</p>',
      }));
    });

    test('returns zero counts on empty queue', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const result = await emailTransport.processQueue();
      expect(result).toEqual({ sent: 0, failed: 0, total: 0 });
    });

    test('counts failures when sendMail throws', async () => {
      // body is the real schema column
      const entry = { id: 11, recipient: 'fail@test.com', subject: 'Bad', body: 'hi' };
      db.query
        .mockResolvedValueOnce([[entry]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      mockSendMail.mockRejectedValueOnce(new Error('Timeout'));

      const result = await emailTransport.processQueue();
      expect(result).toEqual({ sent: 0, failed: 1, total: 1 });
    });
  });
});
