// =============================================================================
// FireISP 5.0 — Notification Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const notificationService = require('../src/services/notificationService');

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendNotification', () => {
    test('sends email notification with template', async () => {
      const template = { id: 1, subject: 'Hello {{name}}', body: 'Dear {{name}}, your balance is {{amount}}' };

      db.query
        .mockResolvedValueOnce([[template]])  // template lookup
        .mockResolvedValueOnce([{ insertId: 1 }]);  // email_logs INSERT
      // No `notifications` INSERT: notifications.user_id is NOT NULL and the table
      // has no organization_id/status column — the row this service used to write
      // could never be inserted (database/schema.sql).

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'email',
        templateId: 1,
        recipientEmail: 'john@example.com',
        variables: { name: 'John', amount: '$500' },
      });

      expect(result.channel).toBe('email');
      expect(result.subject).toBe('Hello John');
      expect(result.body).toContain('Dear John');
      expect(result.body).toContain('$500');
    });

    test('sends SMS notification', async () => {
      const template = { id: 2, subject: 'Payment Due', body: 'Your payment of {{amount}} is due.' };

      db.query
        .mockResolvedValueOnce([[template]])
        .mockResolvedValueOnce([{ insertId: 1 }]);  // sms_logs INSERT

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'sms',
        templateId: 2,
        recipientPhone: '+521234567890',
        variables: { amount: '$500' },
      });

      expect(result.channel).toBe('sms');
      expect(result.body).toContain('$500');
    });

    test('sends WhatsApp notification via sms_logs', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 3, subject: 'Test', body: 'Test body' }]])
        .mockResolvedValueOnce([{ insertId: 1 }]);

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'whatsapp',
        templateId: 3,
        recipientPhone: '+521234567890',
      });

      expect(result.channel).toBe('whatsapp');
    });

    test('handles missing template gracefully', async () => {
      db.query
        .mockResolvedValueOnce([[]])  // template not found
        .mockResolvedValueOnce([{ insertId: 1 }]);  // email_logs

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'email',
        templateId: 999,
        recipientEmail: 'test@example.com',
      });

      expect(result.subject).toBe('');
      expect(result.body).toBe('');
    });

    test('HTML-escapes interpolated variables for the email channel', async () => {
      const template = { id: 4, subject: 'Hi {{name}}', body: 'Dear {{name}} & co, your note: {{note}}' };

      db.query
        .mockResolvedValueOnce([[template]])  // template lookup
        .mockResolvedValueOnce([{ insertId: 1 }]);  // email_logs INSERT

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'email',
        templateId: 4,
        recipientEmail: 'client@example.com',
        variables: { name: "O'Brien <script>", note: 'Tom & Jerry' },
      });

      expect(result.subject).toBe('Hi O&#x27;Brien &lt;script&gt;');
      expect(result.body).toBe('Dear O&#x27;Brien &lt;script&gt; & co, your note: Tom &amp; Jerry');
    });

    test('does NOT HTML-escape interpolated variables for the sms channel (plain text)', async () => {
      const template = { id: 5, subject: 'SMS', body: 'Hi {{name}}, balance: {{amount}}' };

      db.query
        .mockResolvedValueOnce([[template]])
        .mockResolvedValueOnce([{ insertId: 1 }]);

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'sms',
        templateId: 5,
        recipientPhone: '+521234567890',
        variables: { name: "O'Brien & Sons", amount: '$500' },
      });

      expect(result.body).toBe('Hi O\'Brien & Sons, balance: $500');
    });

    test('sends without template when templateId is null', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }]);  // notifications INSERT only

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'push', // not email/sms/whatsapp, so only in-app notification
      });

      expect(result.subject).toBe('');
    });
  });
});
