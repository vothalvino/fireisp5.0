// =============================================================================
// Tests: Payment Reminder Service
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/emailTransport', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/services/smsTransport', () => ({ queueSms: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const db = require('../src/config/database');
const emailTransport = require('../src/services/emailTransport');
const smsTransport = require('../src/services/smsTransport');
const paymentReminderService = require('../src/services/paymentReminderService');

describe('paymentReminderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // getReminderSettings
  // ---------------------------------------------------------------------------

  describe('getReminderSettings', () => {
    it('returns null when no settings configured', async () => {
      db.query.mockResolvedValueOnce([[]]); // empty result
      const result = await paymentReminderService.getReminderSettings(1);
      expect(result).toBeNull();
    });

    it('returns settings when configured', async () => {
      const settings = { id: 1, organization_id: 1, days_before_due: '[7,3]', send_on_due: 1, days_after_due: '[1,7]', enabled: 1 };
      db.query.mockResolvedValueOnce([[settings]]);
      const result = await paymentReminderService.getReminderSettings(1);
      expect(result).toEqual(settings);
    });
  });

  // ---------------------------------------------------------------------------
  // upsertReminderSettings
  // ---------------------------------------------------------------------------

  describe('upsertReminderSettings', () => {
    it('upserts and returns updated settings', async () => {
      const settings = { id: 1, organization_id: 1, days_before_due: [7], send_on_due: 1, days_after_due: [1], enabled: 1 };
      db.query
        .mockResolvedValueOnce([{}]) // INSERT ... ON DUPLICATE KEY UPDATE
        .mockResolvedValueOnce([[settings]]); // SELECT after upsert

      const result = await paymentReminderService.upsertReminderSettings(1, {
        days_before_due: [7],
        send_on_due: true,
        days_after_due: [1],
        enabled: true,
      });
      expect(result).toEqual(settings);
    });
  });

  // ---------------------------------------------------------------------------
  // sendPaymentReminders
  // ---------------------------------------------------------------------------

  describe('sendPaymentReminders', () => {
    it('returns early when no settings', async () => {
      db.query.mockResolvedValueOnce([[]]); // no settings
      const result = await paymentReminderService.sendPaymentReminders(1);
      expect(result).toEqual({ reminders_sent: 0, invoices_checked: 0 });
    });

    it('returns early when reminders disabled', async () => {
      db.query.mockResolvedValueOnce([[{ enabled: 0, days_before_due: '[]', days_after_due: '[]', send_on_due: 0 }]]);
      const result = await paymentReminderService.sendPaymentReminders(1);
      expect(result).toEqual({ reminders_sent: 0, invoices_checked: 0 });
    });

    it('sends email reminder for overdue invoice', async () => {
      // Use a due_date 3 days ago → after_3 stage should fire
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const dueStr = threeDaysAgo.toISOString().slice(0, 10);

      const settings = {
        enabled: 1,
        days_before_due: [],
        send_on_due: 0,
        days_after_due: [3],
      };

      const invoice = {
        id: 1, invoice_number: 'INV-000001', total: 100, currency: 'USD',
        due_date: dueStr, client_id: 5,
        client_name: 'Jane Doe', client_email: 'jane@example.com', client_phone: null,
      };

      db.query
        .mockResolvedValueOnce([[settings]]) // getReminderSettings
        .mockResolvedValueOnce([[invoice]])  // SELECT invoices
        .mockResolvedValueOnce([[]])          // isAlreadySent → not sent yet
        .mockResolvedValueOnce([{}]);         // logReminder INSERT IGNORE

      emailTransport.sendEmail.mockResolvedValue(true);

      const result = await paymentReminderService.sendPaymentReminders(1);
      expect(result.reminders_sent).toBe(1);
      expect(emailTransport.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'jane@example.com' }),
      );
    });

    it('skips already-sent reminders (idempotency)', async () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const dueStr = threeDaysAgo.toISOString().slice(0, 10);

      const settings = { enabled: 1, days_before_due: [], send_on_due: 0, days_after_due: [3] };
      const invoice = {
        id: 1, invoice_number: 'INV-000001', total: 100, currency: 'USD',
        due_date: dueStr, client_id: 5,
        client_name: 'Jane Doe', client_email: 'jane@example.com', client_phone: null,
      };

      db.query
        .mockResolvedValueOnce([[settings]])
        .mockResolvedValueOnce([[invoice]])
        .mockResolvedValueOnce([[{ id: 99 }]]); // isAlreadySent → already sent

      const result = await paymentReminderService.sendPaymentReminders(1);
      expect(result.reminders_sent).toBe(0);
      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    });
  });
});
