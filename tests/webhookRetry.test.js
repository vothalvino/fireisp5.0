// =============================================================================
// FireISP 5.0 — Webhook Retry (M5.5) Tests
// =============================================================================
// Tests for async exponential-backoff retry delivery.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('http', () => ({
  request: jest.fn(),
}));
jest.mock('https', () => ({
  request: jest.fn(),
}));

const db = require('../src/config/database');
const http = require('http');
const webhookService = require('../src/services/webhookService');

// ---- Helpers ----------------------------------------------------------------

function mockHttpResponse(statusCode, body = 'OK') {
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

function mockHttpError(message = 'Connection refused') {
  http.request.mockImplementation((opts, cb) => {
    const req = {
      on: jest.fn((event, handler) => {
        if (event === 'error') setImmediate(() => handler(new Error(message)));
        return req;
      }),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    return req;
  });
}

const baseWebhook = {
  id: 10,
  url: 'http://example.com/hook',
  events: 'invoice.created',
  is_enabled: 1,
  secret_encrypted: null,
  max_retries: 5,
  timeout_seconds: 5,
};

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// backoffMs
// =============================================================================
describe('backoffMs()', () => {
  test('returns at least 1000 ms', () => {
    for (let i = 1; i <= 10; i++) {
      expect(webhookService.backoffMs(i)).toBeGreaterThanOrEqual(1000);
    }
  });

  test('is capped at 3 601 000 ms (cap 3600 s + 1 s minimum)', () => {
    for (let i = 1; i <= 20; i++) {
      expect(webhookService.backoffMs(i)).toBeLessThanOrEqual(3601000);
    }
  });

  test('grows as attempt number increases (statistical)', () => {
    const samples = 50;
    let sumLow = 0;
    let sumHigh = 0;
    for (let s = 0; s < samples; s++) {
      sumLow += webhookService.backoffMs(1);
      sumHigh += webhookService.backoffMs(8);
    }
    expect(sumHigh / samples).toBeGreaterThan(sumLow / samples);
  });
});

// =============================================================================
// dispatch()
// =============================================================================
describe('dispatch()', () => {
  test('returns dispatched count and success status on 200', async () => {
    db.query
      .mockResolvedValueOnce([[baseWebhook]])   // SELECT webhooks
      .mockResolvedValueOnce([{ insertId: 1 }]); // INSERT delivery
    mockHttpResponse(200);

    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(1);
    expect(result.results[0].status).toBe('success');
  });

  test('does NOT inline-retry on failure — returns retrying status immediately', async () => {
    db.query
      .mockResolvedValueOnce([[baseWebhook]])
      .mockResolvedValueOnce([{ insertId: 2 }]);
    mockHttpResponse(500);

    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(1);
    // Must be 'retrying' (not 'failed') because max_retries > 0
    expect(result.results[0].status).toBe('retrying');
    expect(result.results[0].next_retry_at).toBeTruthy();
    // HTTP request must have been called exactly ONCE (no inline retries)
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  test('marks dead_letter immediately when max_retries=0 and delivery fails', async () => {
    const noRetryWebhook = { ...baseWebhook, max_retries: 0 };
    db.query
      .mockResolvedValueOnce([[noRetryWebhook]])
      .mockResolvedValueOnce([{ insertId: 3 }]);
    mockHttpResponse(503);

    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.results[0].status).toBe('dead_letter');
  });

  test('skips disabled webhooks (SQL WHERE is_enabled=1 returns empty)', async () => {
    // In production the SQL query filters is_enabled=1, so a disabled webhook
    // never reaches JS. Mock as if SQL returned nothing.
    db.query.mockResolvedValueOnce([[]]);
    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(0);
    expect(http.request).not.toHaveBeenCalled();
  });

  test('skips non-matching events', async () => {
    db.query.mockResolvedValueOnce([[{ ...baseWebhook, events: 'payment.received' }]]);
    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(0);
  });

  test('matches wildcard (*) subscriptions', async () => {
    db.query
      .mockResolvedValueOnce([[{ ...baseWebhook, events: '*' }]])
      .mockResolvedValueOnce([{ insertId: 4 }]);
    mockHttpResponse(200);

    const result = await webhookService.dispatch(42, 'any.event', {});
    expect(result.dispatched).toBe(1);
    expect(result.results[0].status).toBe('success');
  });

  test('returns empty when no webhooks configured', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await webhookService.dispatch(42, 'test', {});
    expect(result.dispatched).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

// =============================================================================
// deliverOnce()
// =============================================================================
describe('deliverOnce()', () => {
  test('success on 201 response', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 5 }]);
    mockHttpResponse(201, 'Created');

    const result = await webhookService.deliverOnce(baseWebhook, 'test', { x: 1 }, 1);
    expect(result.status).toBe('success');
    expect(result.attempt_number).toBe(1);
  });

  test('schedules retry with next_retry_at when attempt < max_retries', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 6 }]);
    mockHttpResponse(500);

    const result = await webhookService.deliverOnce(baseWebhook, 'test', {}, 1);
    expect(result.status).toBe('retrying');
    expect(result.next_retry_at).toBeTruthy();
  });

  test('dead_letters when attempt_number equals max_retries', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 7 }]);
    mockHttpResponse(500);

    const result = await webhookService.deliverOnce(
      { ...baseWebhook, max_retries: 3 },
      'test', {}, 3 /* last allowed attempt */,
    );
    expect(result.status).toBe('dead_letter');
  });

  test('updates existing row when deliveryRowId is provided', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockHttpResponse(200);

    const result = await webhookService.deliverOnce(baseWebhook, 'test', {}, 2, 99);
    expect(result.status).toBe('success');
    // Verify UPDATE (not INSERT) was called
    const call = db.query.mock.calls[0];
    expect(call[0]).toMatch(/^UPDATE webhook_deliveries/);
  });

  test('handles network error (rejection) and schedules retry', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 8 }]);
    mockHttpError('ECONNREFUSED');

    const result = await webhookService.deliverOnce(baseWebhook, 'test', {}, 1);
    expect(result.status).toBe('retrying');
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});

// =============================================================================
// processRetries()
// =============================================================================
describe('processRetries()', () => {
  test('returns zero counts when no retries are due', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await webhookService.processRetries();
    expect(result).toEqual({ succeeded: 0, failed: 0, dead_lettered: 0, total: 0 });
  });

  test('processes due retries and counts successes', async () => {
    const dueRow = {
      delivery_id: 20, event_name: 'invoice.created',
      payload: JSON.stringify({ event: 'invoice.created', data: { id: 1 }, timestamp: '2026-01-01' }),
      attempt_number: 1,
      webhook_id: 10, url: 'http://example.com/hook',
      secret_encrypted: null, max_retries: 5, timeout_seconds: 5,
    };
    db.query
      .mockResolvedValueOnce([[dueRow]])          // SELECT due retries
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE delivery row
    mockHttpResponse(200);

    const result = await webhookService.processRetries();
    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  test('dead-letters rows that exceed max_retries', async () => {
    const exhaustedRow = {
      delivery_id: 21, event_name: 'test',
      payload: JSON.stringify({ data: {} }),
      attempt_number: 5,
      webhook_id: 10, url: 'http://example.com/hook',
      secret_encrypted: null, max_retries: 5, timeout_seconds: 5,
    };
    db.query
      .mockResolvedValueOnce([[exhaustedRow]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockHttpResponse(503);

    const result = await webhookService.processRetries();
    expect(result.dead_lettered).toBe(1);
    expect(result.total).toBe(1);
  });
});

// =============================================================================
// listDeadLetters()
// =============================================================================
describe('listDeadLetters()', () => {
  test('returns dead-letter rows for the organization', async () => {
    const rows = [{ id: 30, status: 'dead_letter', event_name: 'invoice.created' }];
    db.query.mockResolvedValueOnce([rows]);

    const result = await webhookService.listDeadLetters(42);
    expect(result).toEqual(rows);
    expect(db.query.mock.calls[0][0]).toMatch(/dead_letter/);
  });
});

// =============================================================================
// redeliverDeadLetter()
// =============================================================================
describe('redeliverDeadLetter()', () => {
  test('returns not_found for unknown delivery', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await webhookService.redeliverDeadLetter(999);
    expect(result.status).toBe('not_found');
  });

  test('resets row and re-delivers successfully', async () => {
    const dlRow = {
      id: 31, event_name: 'payment.received',
      payload: JSON.stringify({ data: { amount: 100 } }),
      webhook_id: 10, url: 'http://example.com/hook',
      secret_encrypted: null, max_retries: 5, timeout_seconds: 5,
    };
    db.query
      .mockResolvedValueOnce([[dlRow]])           // SELECT dead-letter row
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE to retrying
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE on success
    mockHttpResponse(200);

    const result = await webhookService.redeliverDeadLetter(31);
    expect(result.status).toBe('success');
  });
});

// =============================================================================
// processRetries() — alias for retry processing
// =============================================================================
describe('processRetries() (public API)', () => {
  test('returns zero counts when no pending deliveries', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await webhookService.processRetries();
    expect(result).toHaveProperty('succeeded');
    expect(result).toHaveProperty('total');
  });
});
