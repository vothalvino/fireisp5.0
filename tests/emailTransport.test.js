// =============================================================================
// FireISP 5.0 — Email Transport Service Unit Tests
// =============================================================================
// NOTE: emailTransport.js keeps a module-level singleton `transporter` for
// the global relay, lazily created by init() and NEVER recreated afterwards.
// Every "global transport" test below therefore shares the SAME sendMail
// mock (`mockSendMail`, declared once) — mirrors the pre-existing structure
// of this file. The per-org transports created by getOrgTransport() are NOT
// singletons in the same way (one per distinct orgId, cached in a Map), so
// org-specific tests use fresh mocks per org id without this constraint.
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
  beforeEach(() => {
    jest.clearAllMocks();
    nodemailer.createTransport.mockImplementation(() => ({ sendMail: mockSendMail }));
  });

  // =========================================================================
  // sendEmail — global transport (no org config, or org has none)
  // =========================================================================
  describe('sendEmail() — global transport', () => {
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
    });

    test('caches the resolved transport — a second call does not re-query the DB', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce({
        organization_id: 505, enabled: 1, smtp_host: 'smtp.org505.com', smtp_user: 'u',
        smtp_password_encrypted: 'enc:p',
      });

      await emailTransport.getOrgTransport(505);
      await emailTransport.getOrgTransport(505);

      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledTimes(1);
    });

    test('caches a "no config" (null) result too — does not re-query on every send', async () => {
      EmailSettings.findRawByOrgId.mockResolvedValueOnce(null);

      await emailTransport.getOrgTransport(506);
      await emailTransport.getOrgTransport(506);

      expect(EmailSettings.findRawByOrgId).toHaveBeenCalledTimes(1);
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
