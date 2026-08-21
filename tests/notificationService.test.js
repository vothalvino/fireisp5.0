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

const mockSendEmail = jest.fn().mockResolvedValue({ success: true, messageId: 'email-id' });
jest.mock('../src/services/emailTransport', () => ({
  sendEmail: mockSendEmail,
}));

const mockQueueSms = jest.fn().mockResolvedValue(123);
jest.mock('../src/services/smsTransport', () => ({
  queueSms: mockQueueSms,
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

      db.query.mockResolvedValueOnce([[template]]);
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
        messageClass: 'transactional',
      });

      expect(result.channel).toBe('email');
      expect(result.subject).toBe('Hello John');
      expect(result.body).toContain('Dear John');
      expect(result.body).toContain('$500');
      expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 42,
        clientId: 100,
        messageClass: 'transactional',
        to: 'john@example.com',
      }));
    });

    test('sends SMS notification', async () => {
      const template = { id: 2, subject: 'Payment Due', body: 'Your payment of {{amount}} is due.' };

      db.query.mockResolvedValueOnce([[template]]);

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'sms',
        templateId: 2,
        recipientPhone: '+521234567890',
        variables: { amount: '$500' },
        messageClass: 'transactional',
      });

      expect(result.channel).toBe('sms');
      expect(result.body).toContain('$500');
      expect(mockQueueSms).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 42,
        clientId: 100,
        messageClass: 'transactional',
        channel: 'sms',
      }));
    });

    test('sends WhatsApp notification via sms_logs', async () => {
      db.query.mockResolvedValueOnce([[{ id: 3, subject: 'Test', body: 'Test body' }]]);

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'whatsapp',
        templateId: 3,
        recipientPhone: '+521234567890',
        messageClass: 'support_reply',
      });

      expect(result.channel).toBe('whatsapp');
      expect(mockQueueSms).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 42,
        clientId: 100,
        messageClass: 'support_reply',
        channel: 'whatsapp',
      }));
    });

    test('handles missing template gracefully', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'email',
        templateId: 999,
        recipientEmail: 'test@example.com',
        messageClass: 'transactional',
      });

      expect(result.subject).toBe('');
      expect(result.body).toBe('');
    });

    test('HTML-escapes interpolated variables for the email channel', async () => {
      const template = { id: 4, subject: 'Hi {{name}}', body: 'Dear {{name}} & co, your note: {{note}}' };

      db.query.mockResolvedValueOnce([[template]]);

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'email',
        templateId: 4,
        recipientEmail: 'client@example.com',
        variables: { name: "O'Brien <script>", note: 'Tom & Jerry' },
        messageClass: 'transactional',
      });

      expect(result.subject).toBe('Hi O&#x27;Brien &lt;script&gt;');
      expect(result.body).toBe('Dear O&#x27;Brien &lt;script&gt; & co, your note: Tom &amp; Jerry');
    });

    test('does NOT HTML-escape interpolated variables for the sms channel (plain text)', async () => {
      const template = { id: 5, subject: 'SMS', body: 'Hi {{name}}, balance: {{amount}}' };

      db.query.mockResolvedValueOnce([[template]]);

      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'sms',
        templateId: 5,
        recipientPhone: '+521234567890',
        variables: { name: "O'Brien & Sons", amount: '$500' },
        messageClass: 'transactional',
      });

      expect(result.body).toBe('Hi O\'Brien & Sons, balance: $500');
    });

    test('sends without template when templateId is null', async () => {
      const result = await notificationService.sendNotification({
        organizationId: 42,
        clientId: 100,
        channel: 'push', // not email/sms/whatsapp, so only in-app notification
      });

      expect(result.subject).toBe('');
    });
  });
});
