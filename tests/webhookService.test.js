// =============================================================================
// FireISP 5.0 — Webhook Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

// Mock http/https to avoid real network calls
jest.mock('http', () => ({
  request: jest.fn(),
}));
jest.mock('https', () => ({
  request: jest.fn(),
}));

const db = require('../src/config/database');
const http = require('http');
const webhookService = require('../src/services/webhookService');

describe('webhookService', () => {
  beforeEach(() => jest.clearAllMocks());

  // Helper to mock successful HTTP request
  function mockHttpSuccess(statusCode = 200, body = 'OK') {
    http.request.mockImplementation((opts, cb) => {
      const res = {
        statusCode,
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(body);
          if (event === 'end') handler();
          return res;
        }),
      };
      cb(res);
      return {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
      };
    });
  }

  // =========================================================================
  // dispatch
  // =========================================================================
  describe('dispatch()', () => {
    test('delivers to matching webhooks', async () => {
      const webhook = {
        id: 1, url: 'http://example.com/hook', events: 'invoice.created,payment.received',
        is_enabled: 1, secret_encrypted: null, max_retries: 0, timeout_seconds: 5,
      };
      db.query
        .mockResolvedValueOnce([[webhook]])  // SELECT webhooks
        .mockResolvedValueOnce([]);           // INSERT delivery log

      mockHttpSuccess(200);

      const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
      expect(result.dispatched).toBe(1);
      expect(result.results[0].status).toBe('success');
    });

    test('skips webhooks that do not match event', async () => {
      const webhook = {
        id: 1, url: 'http://example.com/hook', events: 'payment.received',
        is_enabled: 1, secret_encrypted: null, max_retries: 0, timeout_seconds: 5,
      };
      db.query.mockResolvedValueOnce([[webhook]]);

      const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
      expect(result.dispatched).toBe(0);
    });

    test('matches wildcard (*) event subscriptions', async () => {
      const webhook = {
        id: 2, url: 'http://example.com/all', events: '*',
        is_enabled: 1, secret_encrypted: null, max_retries: 0, timeout_seconds: 5,
      };
      db.query
        .mockResolvedValueOnce([[webhook]])
        .mockResolvedValueOnce([]);

      mockHttpSuccess(200);

      const result = await webhookService.dispatch(42, 'any.event', {});
      expect(result.dispatched).toBe(1);
    });

    test('returns empty when no webhooks exist', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await webhookService.dispatch(42, 'test', {});
      expect(result.dispatched).toBe(0);
    });
  });

  // =========================================================================
  // deliver
  // =========================================================================
  describe('deliver()', () => {
    test('dead_letters immediately when max_retries=0 and delivery fails', async () => {
      const webhook = {
        id: 3, url: 'http://example.com/fail', events: '*',
        secret_encrypted: null, max_retries: 0, timeout_seconds: 1,
      };

      db.query.mockResolvedValue([{ insertId: 99 }]);  // delivery log insert
      mockHttpSuccess(500, 'Internal Server Error');

      const result = await webhookService.deliver(webhook, 'test', { foo: 1 });
      // max_retries=0 means no retries allowed — result is dead_letter after first attempt
      expect(result.status).toBe('dead_letter');
    });
  });

  // =========================================================================
  // processRetries delegate behaviour
  // =========================================================================
  describe('processRetries()', () => {
    test('returns zero counts when no pending deliveries', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await webhookService.processRetries();
      expect(result.succeeded).toBe(0);
      expect(result.total).toBe(0);
    });
  });
});
