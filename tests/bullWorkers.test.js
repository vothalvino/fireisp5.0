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

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTenantContext: jest.fn((_organizationId, callback) => callback()),
  withPrimaryContext: jest.fn(callback => callback()),
}));
jest.mock('../src/services/taskRunner', () => ({
  runTask: jest.fn(),
  markTaskRun: jest.fn(),
}));
jest.mock('../src/services/trapForwardingService', () => ({
  attemptDelivery: jest.fn(),
}));
jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));

// No Redis in unit tests
delete process.env.REDIS_URL;

const db = require('../src/config/database');
const taskRunner = require('../src/services/taskRunner');
const trapForwardingService = require('../src/services/trapForwardingService');
const http = require('http');
const https = require('https');
const jobQueue = require('../src/services/jobQueueService');
const webhookService = require('../src/services/webhookService');
const smsTransport = require('../src/services/smsTransport');
const workers = require('../src/workers');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.withTenantContext.mockImplementation((_organizationId, callback) => callback());
  db.withPrimaryContext.mockImplementation(callback => callback());
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
    expect(QUEUE_NAMES).toContain('trap-forwarding-delivery');
    expect(QUEUE_NAMES).toContain('sms-send');
    expect(QUEUE_NAMES).toContain('cfdi-stamp');
    expect(QUEUE_NAMES).toContain('config-backup');
    expect(QUEUE_NAMES).toContain('ai-triage');
    expect(QUEUE_NAMES).toContain('ai-backfill-embeddings');
    expect(QUEUE_NAMES).toContain('ai-cost-rollup');
  });

  test('getStats() returns in-process mode when REDIS_URL is unset', async () => {
    const stats = await jobQueue.getStats();
    expect(stats).toEqual({ mode: 'in-process', queues: [], active: 0, pending: 0 });
  });

  test('trap-forwarding local capacity preserves overflow as durable pending for retry recovery', async () => {
    jobQueue.process('trap-forwarding-delivery', jest.fn());
    const results = await Promise.all(Array.from(
      { length: 101 },
      (_, index) => jobQueue.add('trap-forwarding-delivery', {
        deliveryId: index + 1,
        organizationId: 42,
      }),
    ));

    expect(results.filter(result => result.status === 'queued')).toHaveLength(100);
    expect(results.filter(result => result.status === 'durable-pending')).toEqual([
      expect.objectContaining({ id: null, name: 'trap-forwarding-delivery' }),
    ]);
    await expect(jobQueue.getStats()).resolves.toMatchObject({
      mode: 'in-process',
      active: 0,
      pending: 100,
      queues: [{ name: 'trap-forwarding-delivery', waiting: 100 }],
    });
    await jobQueue.close();
  });

  test('duplicate durable job IDs do not consume another local queue slot', async () => {
    jobQueue.process('trap-forwarding-delivery', jest.fn());
    const options = { jobId: 'trap-forwarding-42-501' };

    const first = await jobQueue.add(
      'trap-forwarding-delivery',
      { deliveryId: 501, organizationId: 42 },
      options,
    );
    const duplicate = await jobQueue.add(
      'trap-forwarding-delivery',
      { deliveryId: 501, organizationId: 42 },
      options,
    );

    expect(first).toMatchObject({ id: options.jobId, status: 'queued' });
    expect(duplicate).toMatchObject({
      id: options.jobId,
      status: 'queued',
      deduplicated: true,
    });
    await expect(jobQueue.getStats()).resolves.toMatchObject({ pending: 1 });
    await jobQueue.close();
  });

  test('generic local queue capacity fails fast instead of silently dropping a non-durable job', async () => {
    jobQueue.process('sms-send', jest.fn());
    const outcomes = await Promise.allSettled(Array.from(
      { length: 1001 },
      (_, index) => jobQueue.add('sms-send', { logId: index + 1 }),
    ));

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1000);
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'JOB_QUEUE_CAPACITY' });
    await expect(jobQueue.getStats()).resolves.toMatchObject({ pending: 1000, active: 0 });
    await jobQueue.close();
  });
});

// ============================================================================
// Worker Registry
// ============================================================================
describe('workers/index.js — registerWorkers()', () => {
  test('registers handlers for all 9 named queues', () => {
    const processSpy = jest.spyOn(jobQueue, 'process');
    workers.registerWorkers();
    const names = processSpy.mock.calls.map(([name]) => name);
    expect(names).toContain('scheduled-task');
    expect(names).toContain('webhook-delivery');
    expect(names).toContain('trap-forwarding-delivery');
    expect(names).toContain('sms-send');
    expect(names).toContain('cfdi-stamp');
    expect(names).toContain('config-backup');
    expect(names).toContain('ai-triage');
    expect(names).toContain('ai-backfill-embeddings');
    expect(names).toContain('ai-cost-rollup');
    expect(names).toHaveLength(9);
  });

  test('registerWorkers() is idempotent — second call is a no-op', () => {
    const processSpy = jest.spyOn(jobQueue, 'process');
    workers.registerWorkers();
    workers.registerWorkers();
    expect(processSpy).toHaveBeenCalledTimes(9);
  });

  test('trap-forwarding worker processes the already-durable delivery id', async () => {
    const processSpy = jest.spyOn(jobQueue, 'process');
    workers.registerWorkers();
    const handler = processSpy.mock.calls.find(([name]) => name === 'trap-forwarding-delivery')[1];
    trapForwardingService.attemptDelivery.mockResolvedValueOnce({ id: 501, status: 'success' });

    await expect(handler({ data: { deliveryId: 501, organizationId: 42 } }))
      .resolves.toEqual({ id: 501, status: 'success' });
    expect(trapForwardingService.attemptDelivery).toHaveBeenCalledWith(501, 42);
    expect(db.withPrimaryContext).toHaveBeenCalledWith(expect.any(Function));
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });

  test('saved-webhook worker enters the organization database context from its durable job', async () => {
    const processSpy = jest.spyOn(jobQueue, 'process');
    const deliverSpy = jest.spyOn(webhookService, 'deliverForWorker')
      .mockResolvedValueOnce({ webhook_id: 7, status: 'success', attempt_number: 1 });
    workers.registerWorkers();
    const handler = processSpy.mock.calls.find(([name]) => name === 'webhook-delivery')[1];
    const job = {
      data: {
        webhookId: 7,
        organizationId: 42,
        event: 'invoice.created',
        payloadJson: '{}',
      },
    };

    try {
      await expect(handler(job)).resolves.toMatchObject({ status: 'success' });
      expect(db.withTenantContext).toHaveBeenCalledWith(42, expect.any(Function));
      expect(deliverSpy).toHaveBeenCalledWith(job);
    } finally {
      deliverSpy.mockRestore();
    }
  });

  test('scheduled-task worker preserves overlap as skipped on the exact row', async () => {
    const processSpy = jest.spyOn(jobQueue, 'process');
    workers.registerWorkers();
    const handler = processSpy.mock.calls.find(([name]) => name === 'scheduled-task')[1];
    const skipped = { skipped: true, reason: 'already_running' };
    taskRunner.runTask.mockResolvedValueOnce(skipped);
    taskRunner.markTaskRun.mockResolvedValueOnce(undefined);

    const result = await handler({
      data: {
        taskId: 455,
        taskName: 'poll_pppoe_events',
        organizationId: null,
      },
    });

    expect(result).toEqual(skipped);
    expect(taskRunner.markTaskRun).toHaveBeenCalledWith(
      'poll_pppoe_events',
      skipped,
      { taskId: 455, organizationId: null },
    );
  });
});

// ============================================================================
// webhookService.deliverForWorker()
// ============================================================================
describe('webhookService.deliverForWorker()', () => {
  beforeEach(() => {
    // Keep legacy worker fixtures focused on delivery behavior; lifecycle
    // regressions below execute the authoritative primary lookup explicitly.
    db.withPrimaryContext.mockResolvedValue({ active: true, epoch: 7 });
  });

  function mockHttp(statusCode = 200, body = 'OK') {
    https.request.mockImplementation((_opts, cb) => {
      const res = {
        statusCode,
        socket: { remoteAddress: '8.8.8.8' },
        resume: jest.fn(),
        destroy: jest.fn(),
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
        organizationId: 42,
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

  test('rejects a rowless legacy job without any database lookup or network request', async () => {
    const result = await webhookService.deliverForWorker(makeJob());
    expect(result).toEqual({ status: 'legacy_job_rejected', webhook_id: 1 });
    expect(db.query).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a rowless job cannot probe a same-id saved webhook in another organization', async () => {
    await expect(webhookService.deliverForWorker(makeJob())).resolves.toEqual({
      status: 'legacy_job_rejected',
      webhook_id: 1,
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a suspended owner terminalizes its exact durable row without opening a socket', async () => {
    db.withPrimaryContext.mockImplementation(callback => callback());
    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT id, outbound_delivery_epoch FROM organizations/.test(sql)) {
        expect(params).toEqual([42]);
        return Promise.resolve([[]]);
      }
      if (/UPDATE webhook_deliveries wd[\s\S]*JOIN webhooks/.test(sql)) {
        expect(sql).toMatch(/WHERE wd\.id = \? AND w\.organization_id = \?/);
        expect(params).toEqual([77, 42]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      throw new Error(`Unexpected inactive-owner worker SQL: ${sql}`);
    });

    await expect(webhookService.deliverForWorker(makeJob({ deliveryRowId: 77 })))
      .resolves.toEqual({
        status: 'dead_letter',
        reason: 'organization_inactive',
        delivery_id: 77,
      });
    expect(db.withPrimaryContext).toHaveBeenCalledWith(expect.any(Function));
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a rowless job is rejected even when its obsolete transport fixture would succeed', async () => {
    mockHttp(200);
    const result = await webhookService.deliverForWorker(makeJob());
    expect(result).toEqual({ status: 'legacy_job_rejected', webhook_id: 1 });
    expect(db.query).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a rowless job cannot enter the obsolete Bull retry path', async () => {
    mockHttp(500);
    await expect(webhookService.deliverForWorker(makeJob())).resolves.toEqual({
      status: 'legacy_job_rejected',
      webhook_id: 1,
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a final-attempt marker does not make a rowless job eligible', async () => {
    mockHttp(500);
    const job = makeJob({}, { attemptsMade: 5 }); // 6th attempt of 6 = final
    const result = await webhookService.deliverForWorker(job);
    expect(result).toEqual({ status: 'legacy_job_rejected', webhook_id: 1 });
    expect(db.query).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('UPDATEs existing row when deliveryRowId is set', async () => {
    mockHttp(200);
    db.query.mockImplementation((sql, params = []) => {
      if (/UPDATE webhook_deliveries wd[\s\S]*SET wd\.claim_token/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT w\.\*, wd\.id AS delivery_id/.test(sql)) {
        return Promise.resolve([[
          {
            id: 1,
            organization_id: 42,
            url: 'https://8.8.8.8/hook',
            secret_encrypted: null,
            max_retries: 5,
            timeout_seconds: 10,
            delivery_id: 77,
            delivery_event: 'invoice.created',
            delivery_payload: JSON.stringify({ event: 'invoice.created', data: { invoiceId: 99 } }),
            delivery_target_url: 'https://8.8.8.8/hook',
            delivery_organization_epoch: 7,
            attempt_number: 2,
            claim_token: params[2],
          },
        ]]);
      }
      if (/UPDATE webhook_deliveries[\s\S]*status = 'processing' AND claim_token = \?/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      throw new Error(`Unexpected durable worker SQL: ${sql}`);
    });
    const job = makeJob({ deliveryRowId: 77 }, { attemptsMade: 1 });
    const result = await webhookService.deliverForWorker(job);
    expect(result.status).toBe('success');
    expect(db.query.mock.calls[0][0]).toMatch(/w\.organization_id = \?/);
    expect(db.query.mock.calls[0][0]).toMatch(/BINARY wd\.target_url = BINARY w\.url/);
    expect(db.query.mock.calls[0][0]).toMatch(/wd\.organization_epoch = \?/);
    expect(db.query.mock.calls[0][0]).toMatch(/wd\.revoked_at IS NULL/);
    expect(db.query.mock.calls[0][0]).toMatch(/wd\.recovery_count/);
    expect(db.query.mock.calls[0][1].slice(1)).toEqual([77, 42, 7]);
    expect(db.query.mock.calls[2][0]).toMatch(/claim_token = \?/);
    expect(db.query.mock.calls[2][0]).toMatch(/status = 'processing'/);
  });

  test('a stale organization epoch fails the durable claim and is terminalized without HTTP', async () => {
    db.query.mockImplementation((sql, params = []) => {
      if (/UPDATE webhook_deliveries wd[\s\S]*SET wd\.claim_token/.test(sql)) {
        expect(sql).toMatch(/wd\.organization_epoch = \?/);
        expect(params.slice(1)).toEqual([77, 42, 7]);
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      if (/wd\.organization_epoch <> \?/.test(sql)) {
        expect(params).toEqual([77, 42, 7]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      throw new Error(`Unexpected stale-epoch claim SQL: ${sql}`);
    });

    await expect(webhookService.deliverForWorker(makeJob({ deliveryRowId: 77 })))
      .resolves.toEqual({ status: 'not_due', delivery_id: 77 });
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a case-only capability-token change cannot satisfy the durable claim', async () => {
    db.query.mockImplementation(sql => {
      if (/UPDATE webhook_deliveries wd[\s\S]*SET wd\.claim_token/.test(sql)) {
        expect(sql).toMatch(/BINARY wd\.target_url = BINARY w\.url/);
        // The real database sees TokenA and tokena as distinct because of the
        // explicit binary predicate, even under a case-insensitive collation.
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      if (/wd\.organization_epoch <> \?/.test(sql)) {
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      throw new Error(`Unexpected case-only claim SQL: ${sql}`);
    });

    await expect(webhookService.deliverForWorker(makeJob({ deliveryRowId: 77 })))
      .resolves.toEqual({ status: 'not_due', delivery_id: 77 });
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('suspension after claim CAS-dead-letters the owned row before any HTTP request', async () => {
    db.withPrimaryContext
      .mockResolvedValueOnce({ active: true, epoch: 7 })
      .mockResolvedValueOnce({ active: false, epoch: 8 });
    db.query.mockImplementation((sql, params = []) => {
      if (/UPDATE webhook_deliveries wd[\s\S]*SET wd\.claim_token/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT w\.\*, wd\.id AS delivery_id/.test(sql)) {
        return Promise.resolve([[
          {
            id: 1,
            organization_id: 42,
            url: 'https://8.8.8.8/hook',
            secret_encrypted: null,
            max_retries: 5,
            timeout_seconds: 10,
            delivery_id: 77,
            delivery_event: 'invoice.created',
            delivery_payload: '{}',
            delivery_target_url: 'https://8.8.8.8/hook',
            delivery_organization_epoch: 7,
            attempt_number: 2,
            claim_token: params[2],
          },
        ]]);
      }
      if (/UPDATE webhook_deliveries[\s\S]*status = 'processing' AND claim_token = \?/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      throw new Error(`Unexpected suspension-race SQL: ${sql}`);
    });

    await expect(webhookService.deliverForWorker(makeJob({ deliveryRowId: 77 })))
      .resolves.toEqual({
        status: 'dead_letter',
        delivery_id: 77,
        reason: 'organization_inactive',
      });
    expect(db.withPrimaryContext).toHaveBeenCalledTimes(2);
    const outcome = db.query.mock.calls[2];
    expect(outcome[0]).toMatch(/WHERE id = \? AND webhook_id = \?[\s\S]*claim_token = \?/);
    expect(outcome[1][2]).toBe('dead_letter');
    expect(outcome[1].slice(-3, -1)).toEqual([77, 1]);
    expect(outcome[1].at(-1)).toEqual(expect.any(String));
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('suspend-reactivate epoch change after claim CAS-dead-letters before HTTP even when active', async () => {
    db.withPrimaryContext
      .mockResolvedValueOnce({ active: true, epoch: 7 })
      .mockResolvedValueOnce({ active: true, epoch: 9 });
    db.query.mockImplementation((sql, params = []) => {
      if (/UPDATE webhook_deliveries wd[\s\S]*SET wd\.claim_token/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT w\.\*, wd\.id AS delivery_id/.test(sql)) {
        return Promise.resolve([[
          {
            id: 1,
            organization_id: 42,
            url: 'https://8.8.8.8/hook',
            delivery_id: 77,
            delivery_event: 'invoice.created',
            delivery_payload: '{}',
            delivery_target_url: 'https://8.8.8.8/hook',
            delivery_organization_epoch: 7,
            attempt_number: 2,
            claim_token: params[2],
          },
        ]]);
      }
      if (/UPDATE webhook_deliveries[\s\S]*status = 'processing' AND claim_token = \?/.test(sql)) {
        expect(params[2]).toBe('dead_letter');
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      throw new Error(`Unexpected reactivation-epoch SQL: ${sql}`);
    });

    await expect(webhookService.deliverForWorker(makeJob({ deliveryRowId: 77 })))
      .resolves.toEqual({
        status: 'dead_letter',
        delivery_id: 77,
        reason: 'organization_inactive',
      });
    expect(db.withPrimaryContext).toHaveBeenCalledTimes(2);
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('invalid embedded payload does not bypass durable-row enforcement', async () => {
    mockHttp(200);
    const result = await webhookService.deliverForWorker(makeJob({ payloadJson: 'not-valid-json' }));
    expect(result).toEqual({ status: 'legacy_job_rejected', webhook_id: 1 });
    expect(db.query).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });
});

// ============================================================================
// webhookService.dispatch()
// ============================================================================
describe('webhookService.dispatch()', () => {
  beforeEach(() => {
    db.withPrimaryContext.mockResolvedValue({ active: true, epoch: 7 });
  });

  test('uses the durable in-process queue when REDIS_URL is unset', async () => {
    jobQueue.process('webhook-delivery', jest.fn());
    db.query
      .mockResolvedValueOnce([[{ id: 1, organization_id: 1, url: 'https://8.8.8.8/w', events: 'invoice.created', is_enabled: 1, secret_encrypted: null, max_retries: 3, timeout_seconds: 5 }]])
      .mockResolvedValueOnce([{ insertId: 601 }]);
    const result = await webhookService.dispatch(1, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(1);
    expect(result.results[0]).toMatchObject({ delivery_id: 601, status: 'queued' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('returns no results when no webhooks match the event', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, organization_id: 1, url: 'https://8.8.8.8/w', events: 'payment.received', is_enabled: 1, secret_encrypted: null, max_retries: 3, timeout_seconds: 5 },
    ]]);
    const result = await webhookService.dispatch(1, 'invoice.created', {});
    expect(result.dispatched).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  test('wildcard * event matches all events', async () => {
    jobQueue.process('webhook-delivery', jest.fn());
    db.query
      .mockResolvedValueOnce([[{ id: 2, organization_id: 1, url: 'https://8.8.8.8/w2', events: '*', is_enabled: 1, secret_encrypted: null, max_retries: 2, timeout_seconds: 5 }]])
      .mockResolvedValueOnce([{ insertId: 602 }]);
    const result = await webhookService.dispatch(1, 'ticket.created', { ticketId: 5 });
    expect(result.dispatched).toBe(1);
    expect(result.results[0].status).toBe('queued');
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
