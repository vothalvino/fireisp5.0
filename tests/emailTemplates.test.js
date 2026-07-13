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

    it('HTML-escapes clientName/orgName instead of interpolating them raw', () => {
      const result = templates.welcomeEmail({
        clientName: '<b>Injected</b>',
        orgName: '<i>Evil ISP</i>',
        portalUrl: 'https://portal.isp.mx',
      });
      expect(result.html).not.toContain('<b>Injected</b>');
      expect(result.html).not.toContain('<i>Evil ISP</i>');
      expect(result.html).toContain('&lt;b&gt;Injected&lt;/b&gt;');
      expect(result.html).toContain('&lt;i&gt;Evil ISP&lt;/i&gt;');
      // Subject is plain text, never rendered as HTML — escaping it would
      // show literal entities to the recipient, so it stays raw.
      expect(result.subject).toContain('<i>Evil ISP</i>');
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

    it('HTML-escapes clientName and each line item description', () => {
      const result = templates.invoiceEmail({
        clientName: '<script>x</script>',
        total: 100,
        currency: 'MXN',
        items: [{ description: '"><img src=x onerror=alert(1)>', amount: 100 }],
      });
      expect(result.html).not.toContain('<script>x</script>');
      expect(result.html).not.toContain('"><img src=x onerror=alert(1)>');
      expect(result.html).toContain('&lt;script&gt;x&lt;/script&gt;');
      expect(result.html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
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

    it('HTML-escapes clientName and reference instead of interpolating them raw', () => {
      const result = templates.paymentReceiptEmail({
        clientName: '<script>x</script>',
        amount: 100,
        currency: 'MXN',
        reference: "'; DROP TABLE payments; --<b>",
      });
      expect(result.html).not.toContain('<script>x</script>');
      expect(result.html).not.toContain('<b>');
      expect(result.html).toContain('&lt;script&gt;x&lt;/script&gt;');
      expect(result.html).toContain('&#x27;; DROP TABLE payments; --&lt;b&gt;');
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

    it('HTML-escapes a userName containing markup instead of interpolating it raw', () => {
      const result = templates.passwordResetEmail({
        userName: '<script>alert(1)</script>',
        resetUrl: 'https://isp.mx/reset?token=abc123',
      });
      expect(result.html).not.toContain('<script>alert(1)</script>');
      expect(result.html).toContain('&lt;script&gt;');
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

    it('HTML-escapes a userName containing markup instead of interpolating it raw', () => {
      const result = templates.emailVerificationEmail({
        userName: '<img src=x onerror=alert(1)>',
        verifyUrl: 'https://isp.mx/verify?token=xyz',
      });
      expect(result.html).not.toContain('<img src=x onerror=alert(1)>');
      expect(result.html).toContain('&lt;img');
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

    it('HTML-escapes clientName/orgName instead of interpolating them raw', () => {
      const result = templates.suspensionWarningEmail({
        clientName: '<script>x</script>',
        orgName: '<script>y</script>',
        total: 300,
        currency: 'USD',
      });
      expect(result.html).not.toContain('<script>x</script>');
      expect(result.html).not.toContain('<script>y</script>');
      expect(result.html).toContain('&lt;script&gt;x&lt;/script&gt;');
      expect(result.html).toContain('&lt;script&gt;y&lt;/script&gt;');
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

    it('HTML-escapes clientName/orgName instead of interpolating them raw', () => {
      const result = templates.serviceSuspendedEmail({
        clientName: '<script>x</script>',
        orgName: '<script>y</script>',
        contractId: 42,
        total: 600,
        currency: 'MXN',
      });
      expect(result.html).not.toContain('<script>x</script>');
      expect(result.html).not.toContain('<script>y</script>');
      expect(result.html).toContain('&lt;script&gt;x&lt;/script&gt;');
      expect(result.html).toContain('&lt;script&gt;y&lt;/script&gt;');
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

    it('HTML-escapes clientName/orgName/outageTitle/affectedArea instead of interpolating them raw', () => {
      const result = templates.outageNotificationEmail({
        clientName: '<script>a</script>',
        orgName: '<script>b</script>',
        outageTitle: '<script>c</script>',
        affectedArea: '<script>d</script>',
        severity: 'critical',
      });
      expect(result.html).not.toContain('<script>a</script>');
      expect(result.html).not.toContain('<script>b</script>');
      expect(result.html).not.toContain('<script>c</script>');
      expect(result.html).not.toContain('<script>d</script>');
      expect(result.html).toContain('&lt;script&gt;a&lt;/script&gt;');
      expect(result.html).toContain('&lt;script&gt;b&lt;/script&gt;');
      expect(result.html).toContain('&lt;script&gt;c&lt;/script&gt;');
      expect(result.html).toContain('&lt;script&gt;d&lt;/script&gt;');
    });
  });
});
