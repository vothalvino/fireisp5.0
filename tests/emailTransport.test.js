// =============================================================================
// FireISP 5.0 — Email Transport Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const db = require('../src/config/database');
const emailTransport = require('../src/services/emailTransport');

describe('emailTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // sendEmail
  // =========================================================================
  describe('sendEmail()', () => {
    test('sends email and logs success', async () => {
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
      mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
      db.query.mockResolvedValueOnce([{ insertId: 2 }]);

      const result = await emailTransport.sendEmail({
        organizationId: 42,
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
