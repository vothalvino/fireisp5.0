// =============================================================================
// FireISP 5.0 — Email Templates Tests
// =============================================================================

const templates = require('../src/views/emailTemplates');

describe('Email Templates', () => {
  describe('baseLayout()', () => {
    it('wraps content in HTML document', () => {
      const html = templates.baseLayout('<p>Hello</p>');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<p>Hello</p>');
      expect(html).toContain('Powered by FireISP 5.0');
    });

    it('accepts custom footer text', () => {
      const html = templates.baseLayout('<p>Test</p>', 'Custom Footer');
      expect(html).toContain('Custom Footer');
    });
  });

  describe('welcomeEmail()', () => {
    it('generates welcome email with client name and org', () => {
      const result = templates.welcomeEmail({
        clientName: 'Juan García',
        orgName: 'ISP México',
        portalUrl: 'https://portal.isp.mx',
      });
      expect(result.subject).toContain('Welcome to ISP México');
      expect(result.html).toContain('Juan García');
      expect(result.html).toContain('https://portal.isp.mx');
      expect(result.html).toContain('Access Your Account');
    });

    it('uses defaults when no vars provided', () => {
      const result = templates.welcomeEmail({});
      expect(result.subject).toContain('Welcome to FireISP');
      expect(result.html).toContain('Valued Customer');
    });
  });

  describe('invoiceEmail()', () => {
    it('generates invoice notification with amounts', () => {
      const result = templates.invoiceEmail({
        clientName: 'John Doe',
        orgName: 'Test ISP',
        invoiceNumber: 'INV-000001',
        total: 580,
        currency: 'MXN',
        dueDate: '2026-05-01',
        items: [
          { description: 'Internet 100 Mbps', amount: 500 },
          { description: 'IVA 16%', amount: 80 },
        ],
      });
      expect(result.subject).toContain('INV-000001');
      expect(result.subject).toContain('MXN 580.00');
      expect(result.html).toContain('MXN 580.00');
      expect(result.html).toContain('Internet 100 Mbps');
      expect(result.html).toContain('2026-05-01');
    });
  });

  describe('paymentReceiptEmail()', () => {
    it('generates payment receipt with details', () => {
      const result = templates.paymentReceiptEmail({
        clientName: 'María López',
        amount: 580,
        currency: 'MXN',
        paymentMethod: 'SPEI',
        reference: 'REF-12345',
        invoiceNumber: 'INV-000001',
        paymentDate: '2026-04-10',
      });
      expect(result.subject).toContain('Payment Confirmed');
      expect(result.subject).toContain('MXN 580.00');
      expect(result.html).toContain('María López');
      expect(result.html).toContain('SPEI');
      expect(result.html).toContain('REF-12345');
    });
  });

  describe('passwordResetEmail()', () => {
    it('generates password reset email with link', () => {
      const result = templates.passwordResetEmail({
        userName: 'Admin User',
        resetUrl: 'https://isp.mx/reset?token=abc123',
        expiresIn: '1 hour',
      });
      expect(result.subject).toBe('Password Reset Request');
      expect(result.html).toContain('Admin User');
      expect(result.html).toContain('https://isp.mx/reset?token=abc123');
      expect(result.html).toContain('1 hour');
    });
  });

  describe('emailVerificationEmail()', () => {
    it('generates verification email with link', () => {
      const result = templates.emailVerificationEmail({
        userName: 'New User',
        verifyUrl: 'https://isp.mx/verify?token=xyz',
      });
      expect(result.subject).toBe('Verify Your Email Address');
      expect(result.html).toContain('New User');
      expect(result.html).toContain('https://isp.mx/verify?token=xyz');
    });
  });

  describe('suspensionWarningEmail()', () => {
    it('generates suspension warning with overdue info', () => {
      const result = templates.suspensionWarningEmail({
        clientName: 'Test Client',
        orgName: 'Test ISP',
        daysOverdue: 25,
        invoiceNumber: 'INV-000005',
        total: 300,
        currency: 'USD',
        dueDate: '2026-03-15',
      });
      expect(result.subject).toContain('Suspension Warning');
      expect(result.subject).toContain('INV-000005');
      expect(result.html).toContain('25 days');
      expect(result.html).toContain('USD 300.00');
    });
  });

  describe('serviceSuspendedEmail()', () => {
    it('generates suspension notification', () => {
      const result = templates.serviceSuspendedEmail({
        clientName: 'Suspended Client',
        orgName: 'Test ISP',
        contractId: 42,
        total: 600,
        currency: 'MXN',
      });
      expect(result.subject).toContain('Suspended');
      expect(result.html).toContain('contract #42');
      expect(result.html).toContain('MXN 600.00');
    });
  });

  describe('outageNotificationEmail()', () => {
    it('generates outage notification', () => {
      const result = templates.outageNotificationEmail({
        clientName: 'Affected Client',
        orgName: 'Test ISP',
        outageTitle: 'Fiber cut on Main St.',
        severity: 'critical',
        startTime: '2026-04-10 14:30',
        estimatedRestore: '2026-04-10 18:00',
        affectedArea: 'Zone A',
      });
      expect(result.subject).toContain('Fiber cut on Main St.');
      expect(result.html).toContain('CRITICAL');
      expect(result.html).toContain('Zone A');
      expect(result.html).toContain('2026-04-10 18:00');
    });

    it('handles different severity levels', () => {
      const major = templates.outageNotificationEmail({ severity: 'major' });
      expect(major.html).toContain('badge-warning');

      const minor = templates.outageNotificationEmail({ severity: 'minor' });
      expect(minor.html).toContain('badge-success');
    });
  });

  // ===========================================================================
  // HTML-escaping regression coverage. Once the global input-sanitize.js
  // middleware was removed (see src/app.js's security-posture comment),
  // these free-text values are stored exactly as submitted — escaping now
  // has to happen HERE, at render time, or a client/org name containing
  // "<script>" would execute in a real mail client.
  // ===========================================================================
  describe('HTML escaping', () => {
    const XSS = "O'Brien <script>alert(1)</script>";
    const XSS_ESCAPED = 'O&#x27;Brien &lt;script&gt;alert(1)&lt;/script&gt;';

    it('welcomeEmail escapes clientName and orgName', () => {
      const result = templates.welcomeEmail({ clientName: XSS, orgName: 'Tom & Jerry ISP' });
      expect(result.html).not.toContain('<script>alert(1)</script>');
      expect(result.html).toContain(XSS_ESCAPED);
      expect(result.html).toContain('Tom &amp; Jerry ISP');
    });

    it('invoiceEmail escapes clientName, orgName, and line-item descriptions', () => {
      const result = templates.invoiceEmail({
        clientName: XSS,
        orgName: 'Tom & Jerry ISP',
        items: [{ description: '<img src=x onerror=alert(1)>', amount: 10 }],
      });
      expect(result.html).not.toContain('<script>alert(1)</script>');
      expect(result.html).not.toContain('<img src=x onerror=alert(1)>');
      expect(result.html).toContain(XSS_ESCAPED);
      expect(result.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('paymentReceiptEmail escapes clientName, paymentMethod, reference, and invoiceNumber', () => {
      const result = templates.paymentReceiptEmail({
        clientName: XSS,
        paymentMethod: '<b>SPEI</b>',
        reference: '<script>x</script>',
        invoiceNumber: '<script>y</script>',
      });
      expect(result.html).not.toMatch(/<(script|b)>/);
      expect(result.html).toContain(XSS_ESCAPED);
      expect(result.html).toContain('&lt;b&gt;SPEI&lt;/b&gt;');
      expect(result.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    });

    it('passwordResetEmail and emailVerificationEmail escape userName', () => {
      expect(templates.passwordResetEmail({ userName: XSS }).html).toContain(XSS_ESCAPED);
      expect(templates.emailVerificationEmail({ userName: XSS }).html).toContain(XSS_ESCAPED);
    });

    it('suspensionWarningEmail and serviceSuspendedEmail escape clientName/orgName', () => {
      const warning = templates.suspensionWarningEmail({ clientName: XSS, orgName: 'Tom & Jerry ISP' });
      expect(warning.html).not.toContain('<script>alert(1)</script>');
      expect(warning.html).toContain(XSS_ESCAPED);

      const suspended = templates.serviceSuspendedEmail({ clientName: XSS, orgName: 'Tom & Jerry ISP' });
      expect(suspended.html).not.toContain('<script>alert(1)</script>');
      expect(suspended.html).toContain(XSS_ESCAPED);
    });

    it('outageNotificationEmail escapes clientName, outageTitle, and affectedArea', () => {
      const result = templates.outageNotificationEmail({
        clientName: XSS,
        outageTitle: '<script>alert(2)</script>',
        affectedArea: 'Zone <b>A</b>',
      });
      expect(result.html).not.toMatch(/<(script|b)>/);
      expect(result.html).toContain(XSS_ESCAPED);
      expect(result.html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
      expect(result.html).toContain('Zone &lt;b&gt;A&lt;/b&gt;');
    });
  });
});
