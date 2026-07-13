// =============================================================================
// FireISP 5.0 — Notification Hooks Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../src/services/webhookService', () => ({
  dispatch: jest.fn().mockResolvedValue({ dispatched: 0, results: [] }),
}));

jest.mock('../src/routes/events', () => ({
  broadcast: jest.fn(),
}));

jest.mock('../src/views/emailTemplates', () => ({
  invoiceEmail: jest.fn().mockReturnValue({ subject: 'Invoice', html: '<p>Invoice</p>' }),
  paymentReceiptEmail: jest.fn().mockReturnValue({ subject: 'Payment', html: '<p>Payment</p>' }),
  serviceSuspendedEmail: jest.fn().mockReturnValue({ subject: 'Suspended', html: '<p>Suspended</p>' }),
  suspensionWarningEmail: jest.fn().mockReturnValue({ subject: 'Warning', html: '<p>Warning</p>' }),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const emailTransport = require('../src/services/emailTransport');
const webhookService = require('../src/services/webhookService');
const { broadcast } = require('../src/routes/events');
const templates = require('../src/views/emailTemplates');
const logger = require('../src/utils/logger');
const { registerHooks } = require('../src/services/notificationHooks');

describe('notificationHooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventBus.removeAllListeners();
  });

  test('registerHooks logs info message', () => {
    registerHooks();
    expect(logger.info).toHaveBeenCalledWith('Notification hooks registered');
  });

  // =========================================================================
  // invoice.created
  // =========================================================================
  describe('invoice.created', () => {
    beforeEach(() => registerHooks());

    test('sends email, broadcasts SSE, and dispatches webhook', async () => {
      await eventBus.emit('invoice.created', {
        organizationId: 1,
        invoice: { id: 10, invoice_number: 'INV-001', client_id: 5, total: 100.50, currency: 'MXN' },
        client: { name: 'Juan Pérez', email: 'juan@example.com' },
        items: [{ description: 'Internet 50Mbps', amount: 100.50 }],
      });

      // Email
      expect(templates.invoiceEmail).toHaveBeenCalledWith(
        expect.objectContaining({ clientName: 'Juan Pérez', invoiceNumber: 'INV-001' }),
      );
      expect(emailTransport.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 1, to: 'juan@example.com' }),
      );

      // SSE broadcast
      expect(broadcast).toHaveBeenCalledWith(
        'org:1:notifications',
        'invoice.created',
        expect.objectContaining({ invoice_id: 10 }),
      );

      // Webhook
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        1,
        'invoice.created',
        expect.objectContaining({ id: 10, invoice_number: 'INV-001' }),
      );
    });

    test('skips email when client has no email', async () => {
      await eventBus.emit('invoice.created', {
        organizationId: 1,
        invoice: { id: 10, invoice_number: 'INV-001', client_id: 5, total: 50, currency: 'USD' },
        client: { name: 'Jane' },
        items: [],
      });

      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
      // SSE and webhook should still fire
      expect(broadcast).toHaveBeenCalled();
      expect(webhookService.dispatch).toHaveBeenCalled();
    });

    test('handles due_date formatting', async () => {
      await eventBus.emit('invoice.created', {
        organizationId: 1,
        invoice: { id: 10, invoice_number: 'INV-001', client_id: 5, total: 50, currency: 'USD', due_date: '2026-05-01T00:00:00Z' },
        client: { name: 'Test', email: 'test@example.com' },
        items: [],
      });

      expect(templates.invoiceEmail).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: '2026-05-01' }),
      );
    });

    test('catches and logs errors without propagating', async () => {
      emailTransport.sendEmail.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(
        eventBus.emit('invoice.created', {
          organizationId: 1,
          invoice: { id: 1, invoice_number: 'INV-001', client_id: 1, total: 10, currency: 'USD' },
          client: { email: 'fail@example.com' },
          items: [],
        }),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'invoice.created' }),
        'Notification hook error',
      );
    });
  });

  // =========================================================================
  // payment.received
  // =========================================================================
  describe('payment.received', () => {
    beforeEach(() => registerHooks());

    test('sends email, SSE, and webhook on payment', async () => {
      await eventBus.emit('payment.received', {
        organizationId: 2,
        payment: { id: 20, client_id: 5, amount: 250, currency: 'MXN', payment_method: 'card', reference: 'REF-123', created_at: '2026-04-10T10:00:00Z' },
        client: { name: 'Maria Lopez', email: 'maria@example.com' },
      });

      expect(templates.paymentReceiptEmail).toHaveBeenCalledWith(
        expect.objectContaining({ clientName: 'Maria Lopez', amount: 250 }),
      );
      expect(emailTransport.sendEmail).toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalledWith('org:2:notifications', 'payment.received', expect.any(Object));
      expect(webhookService.dispatch).toHaveBeenCalledWith(2, 'payment.received', expect.any(Object));
    });

    test('skips email when no client email', async () => {
      await eventBus.emit('payment.received', {
        organizationId: 2,
        payment: { id: 20, client_id: 5, amount: 100, currency: 'USD' },
        client: { name: 'NoEmail' },
      });

      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // contract.suspended
  // =========================================================================
  describe('contract.suspended', () => {
    beforeEach(() => registerHooks());

    test('sends email, SSE, and webhook', async () => {
      await eventBus.emit('contract.suspended', {
        organizationId: 3,
        contract: { id: 30, client_id: 7 },
        client: { name: 'Bob Smith', email: 'bob@example.com' },
        invoice: { total: 500, currency: 'MXN' },
      });

      expect(templates.serviceSuspendedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ clientName: 'Bob Smith', contractId: 30 }),
      );
      expect(emailTransport.sendEmail).toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalledWith('org:3:notifications', 'contract.suspended', expect.any(Object));
      expect(webhookService.dispatch).toHaveBeenCalledWith(3, 'contract.suspended', expect.any(Object));
    });
  });

  // =========================================================================
  // contract.restored
  // =========================================================================
  describe('contract.restored', () => {
    beforeEach(() => registerHooks());

    test('broadcasts SSE and dispatches webhook (no email)', async () => {
      await eventBus.emit('contract.restored', {
        organizationId: 3,
        contract: { id: 30, client_id: 7 },
        _client: {},
      });

      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalledWith('org:3:notifications', 'contract.restored', expect.objectContaining({ contract_id: 30 }));
      expect(webhookService.dispatch).toHaveBeenCalledWith(3, 'contract.restored', expect.objectContaining({ id: 30 }));
    });
  });

  // =========================================================================
  // suspension.warning
  // =========================================================================
  describe('suspension.warning', () => {
    beforeEach(() => registerHooks());

    test('sends warning email to client', async () => {
      await eventBus.emit('suspension.warning', {
        organizationId: 1,
        _contract: { id: 1 },
        client: { name: 'Ana Garcia', email: 'ana@example.com' },
        invoice: { invoice_number: 'INV-100', total: 300, currency: 'MXN', due_date: '2026-03-01T00:00:00Z' },
        daysOverdue: 15,
      });

      expect(templates.suspensionWarningEmail).toHaveBeenCalledWith(
        expect.objectContaining({ clientName: 'Ana Garcia', daysOverdue: 15, invoiceNumber: 'INV-100' }),
      );
      expect(emailTransport.sendEmail).toHaveBeenCalled();
    });

    test('skips email when no client email', async () => {
      await eventBus.emit('suspension.warning', {
        organizationId: 1,
        _contract: {},
        client: {},
        invoice: {},
        daysOverdue: 5,
      });

      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // outage.reported / outage.resolved
  // =========================================================================
  describe('outage.reported', () => {
    beforeEach(() => registerHooks());

    test('broadcasts SSE and dispatches webhook', async () => {
      await eventBus.emit('outage.reported', {
        organizationId: 1,
        outage: { id: 50, title: 'Fiber cut', severity: 'critical', started_at: '2026-04-13T09:00:00Z' },
      });

      expect(broadcast).toHaveBeenCalledWith('org:1:outages', 'outage.reported', expect.objectContaining({ id: 50, severity: 'critical' }));
      expect(webhookService.dispatch).toHaveBeenCalledWith(1, 'outage.reported', expect.objectContaining({ id: 50 }));
    });
  });

  describe('outage.resolved', () => {
    beforeEach(() => registerHooks());

    test('broadcasts SSE and dispatches webhook', async () => {
      await eventBus.emit('outage.resolved', {
        organizationId: 1,
        outage: { id: 50, title: 'Fiber cut', resolved_at: '2026-04-13T12:00:00Z' },
      });

      expect(broadcast).toHaveBeenCalledWith('org:1:outages', 'outage.resolved', expect.objectContaining({ id: 50 }));
      expect(webhookService.dispatch).toHaveBeenCalledWith(1, 'outage.resolved', expect.objectContaining({ id: 50 }));
    });
  });

  // =========================================================================
  // ticket.created
  // =========================================================================
  describe('ticket.created', () => {
    beforeEach(() => registerHooks());

    test('broadcasts SSE and dispatches webhook', async () => {
      await eventBus.emit('ticket.created', {
        organizationId: 2,
        ticket: { id: 60, subject: 'No internet', client_id: 10, priority: 'high' },
      });

      expect(broadcast).toHaveBeenCalledWith('org:2:notifications', 'ticket.created', expect.objectContaining({ id: 60, priority: 'high' }));
      expect(webhookService.dispatch).toHaveBeenCalledWith(2, 'ticket.created', expect.objectContaining({ id: 60 }));
    });
  });

  // =========================================================================
  // device.offline / device.online
  // =========================================================================
  describe('device.offline', () => {
    beforeEach(() => registerHooks());

    test('broadcasts SSE and dispatches webhook', async () => {
      await eventBus.emit('device.offline', {
        organizationId: 1,
        device: { id: 70, name: 'AP-Tower-1', ip_address: '10.0.0.1', type: 'access_point' },
      });

      expect(broadcast).toHaveBeenCalledWith('org:1:notifications', 'device.offline', expect.objectContaining({ id: 70, name: 'AP-Tower-1' }));
      expect(webhookService.dispatch).toHaveBeenCalledWith(1, 'device.offline', expect.objectContaining({ id: 70 }));
    });
  });

  describe('device.online', () => {
    beforeEach(() => registerHooks());

    test('broadcasts SSE and dispatches webhook', async () => {
      await eventBus.emit('device.online', {
        organizationId: 1,
        device: { id: 70, name: 'AP-Tower-1', ip_address: '10.0.0.1' },
      });

      expect(broadcast).toHaveBeenCalledWith('org:1:notifications', 'device.online', expect.objectContaining({ id: 70 }));
      expect(webhookService.dispatch).toHaveBeenCalledWith(1, 'device.online', expect.objectContaining({ id: 70 }));
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    beforeEach(() => registerHooks());

    test('handles missing client name parts gracefully', async () => {
      await eventBus.emit('invoice.created', {
        organizationId: 1,
        invoice: { id: 1, invoice_number: 'INV-001', client_id: 1, total: 10, currency: 'USD' },
        client: { email: 'test@example.com' },
        items: [],
      });

      // Template called with empty-trimmed name
      expect(templates.invoiceEmail).toHaveBeenCalledWith(
        expect.objectContaining({ clientName: '' }),
      );
    });

    test('handles null invoice in contract.suspended', async () => {
      await eventBus.emit('contract.suspended', {
        organizationId: 1,
        contract: { id: 1, client_id: 1 },
        client: { name: 'Test', email: 'test@example.com' },
        invoice: null,
      });

      expect(templates.serviceSuspendedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ total: undefined, currency: undefined }),
      );
    });
  });

  // =========================================================================
  // service_order.activated
  // =========================================================================
  describe('service_order.activated', () => {
    beforeEach(() => registerHooks());

    test('sends welcome email, broadcasts SSE, and dispatches webhook', async () => {
      await eventBus.emit('service_order.activated', {
        organizationId: 1,
        order: { id: 9, order_number: 'SO-000009', client_id: 5, contract_id: 12 },
        client: { name: 'Acme', email: 'acme@example.com' },
      });

      expect(emailTransport.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 1, to: 'acme@example.com' }),
      );
      expect(broadcast).toHaveBeenCalledWith(
        'org:1:notifications',
        'service_order.activated',
        expect.objectContaining({ order_id: 9, order_number: 'SO-000009' }),
      );
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        1,
        'service_order.activated',
        expect.objectContaining({ id: 9, order_number: 'SO-000009', contract_id: 12 }),
      );
    });

    test('skips email when client is missing, still broadcasts and dispatches', async () => {
      await eventBus.emit('service_order.activated', {
        organizationId: 1,
        order: { id: 9, order_number: 'SO-000009', client_id: null },
        client: null,
      });

      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalled();
      expect(webhookService.dispatch).toHaveBeenCalled();
    });

    test('catches and logs errors without propagating', async () => {
      emailTransport.sendEmail.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(
        eventBus.emit('service_order.activated', {
          organizationId: 1,
          order: { id: 9, order_number: 'SO-000009', client_id: 5 },
          client: { email: 'fail@example.com' },
        }),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'service_order.activated' }),
        'Notification hook error',
      );
    });

    // Regression: the global input-sanitize.js middleware used to
    // HTML-entity-encode every request body, which incidentally "protected"
    // this inline `html` string too. Now that it's removed, the client name
    // interpolated straight into the welcome email must be escaped at this
    // output sink instead.
    test('HTML-escapes the client name in the welcome email body', async () => {
      await eventBus.emit('service_order.activated', {
        organizationId: 1,
        order: { id: 9, order_number: 'SO-000009', client_id: 5, contract_id: 12 },
        client: { name: "O'Brien <script>alert(1)</script>", email: 'acme@example.com' },
      });

      const call = emailTransport.sendEmail.mock.calls[0][0];
      expect(call.html).not.toContain('<script>');
      expect(call.html).toContain('O&#x27;Brien &lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  // =========================================================================
  // followup.due
  // =========================================================================
  describe('followup.due', () => {
    beforeEach(() => registerHooks());

    test('HTML-escapes the reminder title/client name/notes in the email body', async () => {
      await eventBus.emit('followup.due', {
        organizationId: 1,
        reminder: {
          id: 1,
          client_id: 3,
          assignee_email: 'agent@example.com',
          assignee_first_name: 'Pat & Co',
          client_name: "O'Brien <img onerror=x>",
          title: 'Call <b>now</b>',
          notes: 'Wants & needs a callback',
          due_at: '2026-04-13T09:00:00Z',
        },
      });

      const call = emailTransport.sendEmail.mock.calls[0][0];
      expect(call.html).not.toContain('<img onerror=x>');
      expect(call.html).not.toContain('<b>now</b>');
      expect(call.html).toContain('O&#x27;Brien &lt;img onerror=x&gt;');
      expect(call.html).toContain('Call &lt;b&gt;now&lt;/b&gt;');
      expect(call.html).toContain('Wants &amp; needs a callback');
      expect(call.html).toContain('Pat &amp; Co');
    });
  });

  // =========================================================================
  // survey.requested
  // =========================================================================
  describe('survey.requested', () => {
    beforeEach(() => registerHooks());

    test('HTML-escapes the client name and referenced ticket subject', async () => {
      await eventBus.emit('survey.requested', {
        organizationId: 1,
        survey: { id: 1, client_id: 3, survey_type: 'csat', channel: 'email', ticket_id: 7 },
        client: { name: "O'Brien", email: 'client@example.com' },
        ticket: { subject: '<script>alert(1)</script>' },
      });

      const call = emailTransport.sendEmail.mock.calls[0][0];
      expect(call.html).not.toContain('<script>alert(1)</script>');
      expect(call.html).toContain('O&#x27;Brien');
      expect(call.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  // =========================================================================
  // invoice.late_fee_applied
  // =========================================================================
  describe('invoice.late_fee_applied', () => {
    beforeEach(() => registerHooks());

    test('HTML-escapes the client name and late-fee rule name', async () => {
      await eventBus.emit('invoice.late_fee_applied', {
        organizationId: 1,
        invoice: { id: 1, invoice_number: 'INV-001', client_id: 3 },
        client: { name: "O'Brien <script>alert(1)</script>", email: 'client@example.com' },
        rule: { id: 1, name: 'Standard <b>Fee</b> Policy' },
        fee_amount: 10,
        currency: 'USD',
      });

      const call = emailTransport.sendEmail.mock.calls[0][0];
      expect(call.html).not.toContain('<script>alert(1)</script>');
      expect(call.html).not.toContain('<b>Fee</b>');
      expect(call.html).toContain('O&#x27;Brien &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(call.html).toContain('Standard &lt;b&gt;Fee&lt;/b&gt; Policy');
    });
  });

  // =========================================================================
  // outage.reported — admin-notify email leg (broadcast/webhook already
  // covered above; this covers the separate emailTransport.sendEmail call)
  // =========================================================================
  describe('outage.reported — admin email', () => {
    beforeEach(() => registerHooks());

    test('HTML-escapes the outage title in the admin notification email', async () => {
      db.query
        .mockResolvedValueOnce([[{ client_id: 1 }]]) // portal push subscriptions (best-effort, ignored here)
        .mockResolvedValueOnce([[{ email: 'admin@example.com', first_name: 'Admin' }]]); // admins/support

      await eventBus.emit('outage.reported', {
        organizationId: 1,
        outage: { id: 50, title: '<script>alert(1)</script> Fiber cut', severity: 'critical', started_at: '2026-04-13T09:00:00Z' },
      });

      const call = emailTransport.sendEmail.mock.calls.find(c => c[0].to === 'admin@example.com');
      expect(call).toBeTruthy();
      expect(call[0].html).not.toContain('<script>alert(1)</script>');
      expect(call[0].html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Fiber cut');
    });
  });

  // =========================================================================
  // maintenance.scheduled — client-notify email leg
  // =========================================================================
  describe('maintenance.scheduled — client email', () => {
    beforeEach(() => registerHooks());

    test('HTML-escapes the maintenance title and description', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 3, email: 'client@example.com', phone: null, name: "O'Brien" },
      ]]);

      await eventBus.emit('maintenance.scheduled', {
        organizationId: 1,
        maintenance: {
          id: 1,
          title: 'Router <b>upgrade</b>',
          description: 'Expect downtime & brief outages',
          scheduled_at: '2026-04-13T09:00:00Z',
          estimated_duration_minutes: 30,
        },
      });

      const call = emailTransport.sendEmail.mock.calls.find(c => c[0].to === 'client@example.com');
      expect(call).toBeTruthy();
      expect(call[0].html).not.toContain('<b>upgrade</b>');
      expect(call[0].html).toContain('Router &lt;b&gt;upgrade&lt;/b&gt;');
      expect(call[0].html).toContain('Expect downtime &amp; brief outages');
    });
  });

  // =========================================================================
  // ip_pool.threshold
  // =========================================================================
  describe('ip_pool.threshold', () => {
    beforeEach(() => registerHooks());

    test('HTML-escapes the IP pool name in the admin alert email', async () => {
      db.query.mockResolvedValueOnce([[{ email: 'admin@example.com', first_name: 'Admin' }]]);

      await eventBus.emit('ip_pool.threshold', {
        organizationId: 1,
        pool: { id: 1, name: '<script>alert(1)</script> Pool', network: '10.0.0.0/24' },
        percent: 92,
        threshold: 90,
        assigned: 230,
        usable: 250,
      });

      const call = emailTransport.sendEmail.mock.calls.find(c => c[0].to === 'admin@example.com');
      expect(call).toBeTruthy();
      expect(call[0].html).not.toContain('<script>alert(1)</script>');
      expect(call[0].html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Pool');
    });
  });
});
