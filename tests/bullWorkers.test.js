// =============================================================================
// FireISP 5.0 — BullMQ Workers & Queue Platform Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));

// No Redis in unit tests
delete process.env.REDIS_URL;

const db = require('../src/config/database');
const http = require('http');
const jobQueue = require('../src/services/jobQueueService');
const webhookService = require('../src/services/webhookService');
const smsTransport = require('../src/services/smsTransport');
const workers = require('../src/workers');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.REDIS_URL;
  workers._resetForTesting();
});

afterAll(async () => {
  await jobQueue.close();
});

// ============================================================================
// jobQueueService constants
// ============================================================================
describe('jobQueueService constants', () => {
  test('QUEUE_NAMES contains all well-known queue names', () => {
    const { QUEUE_NAMES } = require('../src/services/jobQueueService');
    expect(QUEUE_NAMES).toContain('scheduled-task');
    expect(QUEUE_NAMES).toContain('webhook-delivery');
    expect(QUEUE_NAMES).toContain('sms-send');
    expect(QUEUE_NAMES).toContain('cfdi-stamp');
    expect(QUEUE_NAMES).toContain('config-backup');
  });

  test('getStats() returns in-process mode when REDIS_URL is unset', async () => {
    const stats = await jobQueue.getStats();
    expect(stats).toEqual({ mode: 'in-process', queues: [] });
  });
});

// ============================================================================
// Worker Registry
// ============================================================================
describe('workers/index.js — registerWorkers()', () => {
  test('registers handlers for all 5 named queues', () => {
    const processSpy = jest.spyOn(jobQueue, 'process');
    workers.registerWorkers();
    const names = processSpy.mock.calls.map(([name]) => name);
    expect(names).toContain('scheduled-task');
    expect(names).toContain('webhook-delivery');
    expect(names).toContain('sms-send');
    expect(names).toContain('cfdi-stamp');
    expect(names).toContain('config-backup');
    expect(names).toHaveLength(5);
  });

  test('registerWorkers() is idempotent — second call is a no-op', () => {
    const processSpy = jest.spyOn(jobQueue, 'process');
    workers.registerWorkers();
    workers.registerWorkers();
    expect(processSpy).toHaveBeenCalledTimes(5);
  });
});

// ============================================================================
// webhookService.deliverForWorker()
// ============================================================================
describe('webhookService.deliverForWorker()', () => {
  function mockHttp(statusCode = 200, body = 'OK') {
    http.request.mockImplementation((_opts, cb) => {
      const res = {
        statusCode,
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(body);
          if (event === 'end') handler();
          return res;
        }),
      };
      cb(res);
      return { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    });
  }

  function makeJob(dataOverrides = {}, jobOverrides = {}) {
    return {
      data: {
        webhookId: 1,
        event: 'invoice.created',
        payloadJson: JSON.stringify({ invoiceId: 99 }),
        deliveryRowId: null,
        ...dataOverrides,
      },
      attemptsMade: 0,
      opts: { attempts: 6 },
      update: jest.fn().mockResolvedValue(undefined),
      ...jobOverrides,
    };
  }

  test('returns webhook_disabled when webhook not found in DB', async () => {
    db.query.mockResolvedValueOnce([[]]); // empty webhooks SELECT
    const result = await webhookService.deliverForWorker(makeJob());
    expect(result).toEqual({ status: 'webhook_disabled', webhook_id: 1 });
  });

  test('returns success on HTTP 200 and writes webhook_deliveries row', async () => {
    mockHttp(200);
    db.query
      .mockResolvedValueOnce([[{ id: 1, url: 'http://localhost/hook', secret_encrypted: null, max_retries: 5, timeout_seconds: 10 }]])
      .mockResolvedValueOnce([{}]); // INSERT webhook_deliveries
    const result = await webhookService.deliverForWorker(makeJob());
    expect(result.status).toBe('success');
    expect(result.attempt_number).toBe(1);
  });

  test('throws on HTTP 500 (non-final attempt) so BullMQ retries', async () => {
    mockHttp(500);
    db.query
      .mockResolvedValueOnce([[{ id: 1, url: 'http://localhost/hook', secret_encrypted: null, max_retries: 5, timeout_seconds: 10 }]])
      .mockResolvedValueOnce([{ insertId: 42 }]); // INSERT
    await expect(webhookService.deliverForWorker(makeJob())).rejects.toThrow(/Webhook delivery failed/);
  });

  test('returns dead_letter on final attempt without throwing', async () => {
    mockHttp(500);
    db.query
      .mockResolvedValueOnce([[{ id: 1, url: 'http://localhost/hook', secret_encrypted: null, max_retries: 5, timeout_seconds: 10 }]])
      .mockResolvedValueOnce([{}]); // UPDATE
    const job = makeJob({}, { attemptsMade: 5 }); // 6th attempt of 6 = final
    const result = await webhookService.deliverForWorker(job);
    expect(result.status).toBe('dead_letter');
  });

  test('UPDATEs existing row when deliveryRowId is set', async () => {
    mockHttp(200);
    db.query
      .mockResolvedValueOnce([[{ id: 1, url: 'http://localhost/hook', secret_encrypted: null, max_retries: 5, timeout_seconds: 10 }]])
      .mockResolvedValueOnce([{}]); // UPDATE
    const job = makeJob({ deliveryRowId: 77 }, { attemptsMade: 1 });
    const result = await webhookService.deliverForWorker(job);
    expect(result.status).toBe('success');
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE webhook_deliveries/);
  });

  test('handles invalid payloadJson gracefully', async () => {
    mockHttp(200);
    db.query
      .mockResolvedValueOnce([[{ id: 1, url: 'http://localhost/hook', secret_encrypted: null, max_retries: 5, timeout_seconds: 10 }]])
      .mockResolvedValueOnce([{}]);
    const result = await webhookService.deliverForWorker(makeJob({ payloadJson: 'not-valid-json' }));
    expect(result.status).toBe('success');
  });
});

// ============================================================================
// webhookService.dispatch()
// ============================================================================
describe('webhookService.dispatch()', () => {
  function mockHttp(statusCode = 200) {
    http.request.mockImplementation((_opts, cb) => {
      const res = {
        statusCode,
        on: jest.fn((ev, h) => { if (ev === 'data') h(''); if (ev === 'end') h(); return res; }),
      };
      cb(res);
      return { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    });
  }

  test('uses inline delivery when REDIS_URL is unset', async () => {
    mockHttp(200);
    db.query
      .mockResolvedValueOnce([[{ id: 1, url: 'http://h.test/w', events: 'invoice.created', is_enabled: 1, secret_encrypted: null, max_retries: 3, timeout_seconds: 5 }]])
      .mockResolvedValueOnce([{}]);
    const result = await webhookService.dispatch(1, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(1);
    expect(result.results[0].status).toBe('success');
  });

  test('returns no results when no webhooks match the event', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, url: 'http://h.test/w', events: 'payment.received', is_enabled: 1, secret_encrypted: null, max_retries: 3, timeout_seconds: 5 },
    ]]);
    const result = await webhookService.dispatch(1, 'invoice.created', {});
    expect(result.dispatched).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  test('wildcard * event matches all events', async () => {
    mockHttp(200);
    db.query
      .mockResolvedValueOnce([[{ id: 2, url: 'http://h.test/w2', events: '*', is_enabled: 1, secret_encrypted: null, max_retries: 2, timeout_seconds: 5 }]])
      .mockResolvedValueOnce([{}]);
    const result = await webhookService.dispatch(1, 'ticket.created', { ticketId: 5 });
    expect(result.dispatched).toBe(1);
    expect(result.results[0].status).toBe('success');
  });
});

// ============================================================================
// smsTransport.queueSms() without BullMQ
// ============================================================================
describe('smsTransport.queueSms() without BullMQ', () => {
  test('inserts DB row and returns logId when REDIS_URL is unset', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 55 }]);
    const result = await smsTransport.queueSms({ organizationId: 1, to: '+521234567890', body: 'Test SMS' });
    expect(result).toEqual({ queued: true, logId: 55 });
    expect(db.query).toHaveBeenCalledTimes(1); // only the INSERT
  });
});

// ============================================================================
// jobQueueService.getStats() and queueStats route
// ============================================================================
describe('queue stats', () => {
  test('getStats() returns mode + queues structure', async () => {
    const stats = await jobQueue.getStats();
    expect(stats).toHaveProperty('mode');
    expect(stats).toHaveProperty('queues');
    expect(Array.isArray(stats.queues)).toBe(true);
  });

  test('getStats() mode is in-process when REDIS_URL is unset', async () => {
    const stats = await jobQueue.getStats();
    expect(stats.mode).toBe('in-process');
  });
});
