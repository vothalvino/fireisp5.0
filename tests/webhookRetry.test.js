// =============================================================================
// FireISP 5.0 — Webhook Retry (M5.5) Tests
// =============================================================================
// Tests for async exponential-backoff retry delivery.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(),
}));

jest.mock('http', () => ({
  request: jest.fn(),
}));
jest.mock('https', () => ({
  request: jest.fn(),
}));
jest.mock('../src/services/jobQueueService', () => ({
  add: jest.fn(),
}));

const db = require('../src/config/database');
const http = require('http');
const https = require('https');
const jobQueue = require('../src/services/jobQueueService');
const webhookService = require('../src/services/webhookService');

// ---- Helpers ----------------------------------------------------------------

function mockHttpResponse(statusCode, body = 'OK') {
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
    return {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
  });
}

function mockHttpError(message = 'Connection refused') {
  https.request.mockImplementation((_opts, _cb) => {
    const req = {
      on: jest.fn((event, handler) => {
        if (event === 'error') global.setImmediate(() => handler(new Error(message)));
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
  organization_id: 42,
  url: 'https://8.8.8.8/hook',
  events: 'invoice.created',
  is_enabled: 1,
  secret_encrypted: null,
  max_retries: 5,
  timeout_seconds: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.withPrimaryContext = jest.fn().mockResolvedValue({ active: true, epoch: 7 });
  delete db.withTenantContext;
  jobQueue.add.mockResolvedValue({ id: 'durable-job', status: 'queued' });
});

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
  test('persists and queues a matching delivery without inline HTTP', async () => {
    db.query
      .mockResolvedValueOnce([[baseWebhook]])   // SELECT webhooks
      .mockResolvedValueOnce([{ insertId: 1 }]); // INSERT delivery
    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(1);
    expect(result.results[0]).toMatchObject({
      webhook_id: 10,
      delivery_id: 1,
      status: 'queued',
    });
    expect(jobQueue.add).toHaveBeenCalledWith(
      'webhook-delivery',
      { deliveryId: 1, organizationId: 42 },
      expect.objectContaining({
        jobId: 'webhook-delivery-42-1',
        attempts: 1,
      }),
    );
    const insert = db.query.mock.calls.find(
      ([sql]) => /INSERT INTO webhook_deliveries/.test(sql),
    );
    expect(insert[0]).toMatch(/webhook_id, organization_epoch, event_name/);
    expect(insert[1][1]).toBe(7);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a queue outage leaves the already-persisted delivery pending for sweep recovery', async () => {
    db.query
      .mockResolvedValueOnce([[baseWebhook]])
      .mockResolvedValueOnce([{ insertId: 2 }]);
    jobQueue.add.mockRejectedValueOnce(new Error('Redis unavailable'));

    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(1);
    expect(result.results[0]).toMatchObject({ delivery_id: 2, status: 'pending' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('dispatch leaves retry policy to the ownership worker even when max_retries is zero', async () => {
    const noRetryWebhook = { ...baseWebhook, max_retries: 0 };
    db.query
      .mockResolvedValueOnce([[noRetryWebhook]])
      .mockResolvedValueOnce([{ insertId: 3 }]);
    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.results[0]).toMatchObject({ delivery_id: 3, status: 'queued' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('skips disabled webhooks (SQL WHERE is_enabled=1 returns empty)', async () => {
    // In production the SQL query filters is_enabled=1, so a disabled webhook
    // never reaches JS. Mock as if SQL returned nothing.
    db.query.mockResolvedValueOnce([[]]);
    const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
    expect(result.dispatched).toBe(0);
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
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
    const result = await webhookService.dispatch(42, 'any.event', {});
    expect(result.dispatched).toBe(1);
    expect(result.results[0].status).toBe('queued');
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
    db.query
      .mockResolvedValueOnce([[
        { organization_epoch: 7, target_url: 'https://8.8.8.8/hook' },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockHttpResponse(200);

    const result = await webhookService.deliverOnce(baseWebhook, 'test', {}, 2, 99);
    expect(result.status).toBe('success');
    // Verify UPDATE (not INSERT) was called
    const call = db.query.mock.calls[1];
    expect(call[0]).toMatch(/^UPDATE webhook_deliveries/);
  });

  test('legacy existing-row delivery rejects a case-only capability-token change', async () => {
    const current = { ...baseWebhook, url: 'https://8.8.8.8/hook/tokena' };
    db.query
      .mockResolvedValueOnce([[
        { organization_epoch: 7, target_url: 'https://8.8.8.8/hook/TokenA' },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(webhookService.deliverOnce(current, 'test', {}, 2, 99))
      .resolves.toMatchObject({
        status: 'dead_letter',
        reason: 'organization_lifecycle_changed',
      });
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('legacy existing-row delivery rejects a stale organization lifecycle epoch before HTTP', async () => {
    db.query
      .mockResolvedValueOnce([[{ organization_epoch: 5 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(webhookService.deliverOnce(baseWebhook, 'test', {}, 2, 99))
      .resolves.toMatchObject({
        status: 'dead_letter',
        reason: 'organization_lifecycle_changed',
      });

    expect(db.query.mock.calls[1][0]).toMatch(
      /WHERE wd\.id = \? AND w\.organization_id = \?/,
    );
    expect(db.query.mock.calls[1][1]).toEqual([99, 42]);
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('handles network error (rejection) and schedules retry', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 8 }]);
    mockHttpError('ECONNREFUSED');

    const result = await webhookService.deliverOnce(baseWebhook, 'test', {}, 1);
    expect(result.status).toBe('retrying');
    // Transport details are intentionally normalized so delivery history does
    // not become an internal-network probing oracle.
    expect(result.error).toBe('HTTPS delivery failed.');
  });
});

// =============================================================================
// processRetries()
// =============================================================================
describe('processRetries()', () => {
  test('returns zero counts when no retries are due', async () => {
    db.query.mockImplementation(sql => (
      /SELECT wd\.id AS delivery_id/.test(sql)
        ? Promise.resolve([[]])
        : Promise.resolve([{ affectedRows: 0 }])
    ));
    const result = await webhookService.processRetries();
    expect(result).toEqual({
      succeeded: 0, queued: 0, failed: 0, dead_lettered: 0, total: 0,
    });
  });

  test('queues due durable IDs without performing HTTP in the sweep', async () => {
    const dueRow = {
      delivery_id: 20, event_name: 'invoice.created',
      payload: JSON.stringify({ event: 'invoice.created', data: { id: 1 }, timestamp: '2026-01-01' }),
      attempt_number: 1,
      webhook_id: 10, organization_id: 42, url: 'https://8.8.8.8/hook',
      organization_epoch: 7,
      secret_encrypted: null, max_retries: 5, timeout_seconds: 5,
    };
    db.query.mockImplementation(sql => (
      /SELECT wd\.id AS delivery_id/.test(sql)
        ? Promise.resolve([[dueRow]])
        : Promise.resolve([{ affectedRows: 0 }])
    ));

    const result = await webhookService.processRetries();
    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.queued).toBe(1);
    expect(result.failed).toBe(0);
    expect(jobQueue.add).toHaveBeenCalledWith(
      'webhook-delivery',
      { deliveryId: 20, organizationId: 42 },
      expect.objectContaining({ jobId: 'webhook-delivery-42-20' }),
    );
    const mismatchFence = db.query.mock.calls.find(
      ([sql]) => /wd\.target_url IS NULL/.test(sql),
    );
    expect(mismatchFence[0]).toMatch(
      /NOT \(BINARY wd\.target_url <=> BINARY w\.url\)/,
    );
    const dueSelect = db.query.mock.calls.find(
      ([sql]) => /SELECT wd\.id AS delivery_id/.test(sql),
    );
    expect(dueSelect[0]).toMatch(/WHERE BINARY wd\.target_url = BINARY w\.url/);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('retry sweep terminalizes an active owner stale-epoch outbox instead of queueing it', async () => {
    const stale = {
      delivery_id: 22,
      event_name: 'invoice.created',
      payload: '{}',
      attempt_number: 1,
      webhook_id: 10,
      organization_id: 42,
      organization_epoch: 5,
      url: 'https://8.8.8.8/hook',
      max_retries: 5,
      timeout_seconds: 5,
    };
    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT wd\.id AS delivery_id/.test(sql)) return Promise.resolve([[stale]]);
      if (/WHERE wd\.id = \? AND w\.organization_id = \?/.test(sql)) {
        expect(params).toEqual([22, 42]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    await expect(webhookService.processRetries()).resolves.toEqual({
      succeeded: 0,
      queued: 0,
      failed: 0,
      dead_lettered: 1,
      total: 1,
    });
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('terminalizes an exhausted stale claim before selecting recoverable IDs', async () => {
    db.query.mockImplementation(sql => {
      if (/SET wd\.status = 'dead_letter'/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      if (/SELECT wd\.id AS delivery_id/.test(sql)) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    const result = await webhookService.processRetries();
    expect(result.total).toBe(0);
    expect(jobQueue.add).not.toHaveBeenCalled();
    const exhaustedFence = db.query.mock.calls.find(
      ([sql]) => /recovery_count >= 1/.test(sql),
    );
    expect(exhaustedFence[0]).toMatch(
      /attempt_number >= \(COALESCE\(w\.max_retries, 5\) \+ 1\)/,
    );
    expect(https.request).not.toHaveBeenCalled();
  });

  test('stale processing revocation is terminal after URL restore, disable, delete, or missing parent', async () => {
    db.query.mockImplementation(sql => (
      /SELECT wd\.id AS delivery_id/.test(sql)
        ? Promise.resolve([[]])
        : Promise.resolve([{ affectedRows: /LEFT JOIN webhooks/.test(sql) ? 1 : 0 }])
    ));

    await expect(webhookService.processRetries()).resolves.toMatchObject({
      queued: 0,
      total: 0,
    });
    const revokeFence = db.query.mock.calls.find(
      ([sql]) => /LEFT JOIN webhooks/.test(sql) && /wd\.status = 'processing'/.test(sql),
    );
    expect(revokeFence[0]).toMatch(/locked_at < DATE_SUB\(NOW\(\), INTERVAL 5 MINUTE\)/);
    expect(revokeFence[0]).toMatch(/wd\.revoked_at IS NOT NULL/);
    expect(revokeFence[0]).toMatch(/w\.id IS NULL/);
    expect(revokeFence[0]).toMatch(/w\.is_active <> 1/);
    expect(revokeFence[0]).toMatch(/w\.deleted_at IS NOT NULL/);
    expect(revokeFence[0]).toMatch(/NOT \(BINARY wd\.target_url <=> BINARY w\.url\)/);
    const dueSelect = db.query.mock.calls.find(
      ([sql]) => /SELECT wd\.id AS delivery_id/.test(sql),
    );
    expect(dueSelect[0]).toMatch(/wd\.revoked_at IS NULL/);
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a suspended owner is terminalized by exact organization and delivery without queueing', async () => {
    const dueRow = {
      delivery_id: 20,
      event_name: 'invoice.created',
      payload: '{}',
      attempt_number: 1,
      webhook_id: 10,
      organization_id: 42,
      url: 'https://8.8.8.8/hook',
      secret_encrypted: null,
      max_retries: 5,
      timeout_seconds: 5,
    };
    db.withPrimaryContext = jest.fn(callback => callback());
    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT wd\.id AS delivery_id/.test(sql)) return Promise.resolve([[dueRow]]);
      if (/SELECT id, outbound_delivery_epoch FROM organizations/.test(sql)) {
        expect(params).toEqual([42]);
        return Promise.resolve([[]]);
      }
      if (/UPDATE webhook_deliveries wd[\s\S]*JOIN webhooks/.test(sql)
          && /WHERE wd\.id = \? AND w\.organization_id = \?/.test(sql)) {
        expect(params).toEqual([20, 42]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    await expect(webhookService.processRetries()).resolves.toEqual({
      succeeded: 0,
      queued: 0,
      failed: 0,
      dead_lettered: 1,
      total: 1,
    });
    expect(db.withPrimaryContext).toHaveBeenCalledWith(expect.any(Function));
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('reactivation cannot resurrect an outbox terminalized while its owner was inactive', async () => {
    let ownerActive = false;
    let status = 'pending';
    const dueRow = {
      delivery_id: 21,
      event_name: 'invoice.created',
      payload: '{}',
      attempt_number: 1,
      webhook_id: 10,
      organization_id: 42,
      url: 'https://8.8.8.8/hook',
      max_retries: 5,
      timeout_seconds: 5,
    };
    db.withPrimaryContext = jest.fn(callback => callback());
    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT wd\.id AS delivery_id/.test(sql)) {
        return Promise.resolve([status === 'pending' ? [dueRow] : []]);
      }
      if (/SELECT id, outbound_delivery_epoch FROM organizations/.test(sql)) {
        return Promise.resolve([ownerActive ? [{ id: 42, outbound_delivery_epoch: 7 }] : []]);
      }
      if (/UPDATE webhook_deliveries wd[\s\S]*WHERE wd\.id = \? AND w\.organization_id = \?/.test(sql)) {
        expect(params).toEqual([21, 42]);
        if (status === 'pending') status = 'dead_letter';
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    await expect(webhookService.processRetries()).resolves.toMatchObject({
      queued: 0,
      dead_lettered: 1,
      total: 1,
    });
    expect(status).toBe('dead_letter');

    ownerActive = true;
    await expect(webhookService.processRetries()).resolves.toMatchObject({
      queued: 0,
      dead_lettered: 0,
      total: 0,
    });
    expect(status).toBe('dead_letter');
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('primary recovery excludes every isolated owner and terminalizes suspended isolated rows', async () => {
    let scope = 'none';
    db.withPrimaryContext = jest.fn(async (callback) => {
      const previous = scope;
      scope = 'primary';
      try { return await callback(); } finally { scope = previous; }
    });
    db.withTenantContext = jest.fn(async (organizationId, callback) => {
      const previous = scope;
      scope = `isolated-${organizationId}`;
      try { return await callback(); } finally { scope = previous; }
    });
    db.query.mockImplementation(async (sql, params = []) => {
      if (/FROM organization_database_configs/.test(sql)) {
        expect(scope).toBe('primary');
        return [[
          { organization_id: 22, status: 'active', deleted_at: null },
          { organization_id: 33, status: 'suspended', deleted_at: null },
        ]];
      }
      if (/SELECT id, outbound_delivery_epoch FROM organizations/.test(sql)) {
        expect(scope).toBe('primary');
        expect(params).toEqual([33]);
        return [[]];
      }
      if (/webhook_deliveries/.test(sql)) {
        if (scope === 'primary') {
          expect(sql).toMatch(/w\.organization_id NOT IN \(\?, \?\)/);
          expect(params).toEqual([22, 33]);
        } else if (scope === 'isolated-22') {
          expect(sql).toMatch(/w\.organization_id = \?/);
          expect(params).toEqual([22]);
        } else if (scope === 'isolated-33') {
          if (/WHERE wd\.id = \? AND w\.organization_id = \?/.test(sql)) {
            expect(params).toEqual([330, 33]);
            return [{ affectedRows: 1 }];
          }
          expect(sql).toMatch(/w\.organization_id = \?/);
          expect(params).toEqual([33]);
        } else {
          throw new Error(`Unexpected retry scope: ${scope}`);
        }
        if (/SELECT wd\.id AS delivery_id/.test(sql) && scope === 'isolated-33') {
          return [[{
            delivery_id: 330,
            event_name: 'invoice.created',
            payload: '{}',
            attempt_number: 1,
            webhook_id: 7,
            organization_id: 33,
            url: 'https://8.8.8.8/suspended',
            max_retries: 5,
            timeout_seconds: 5,
          }]];
        }
        return /SELECT wd\.id AS delivery_id/.test(sql) ? [[]] : [{ affectedRows: 0 }];
      }
      throw new Error(`Unexpected retry SQL: ${sql}`);
    });

    await expect(webhookService.processRetries()).resolves.toEqual({
      succeeded: 0,
      queued: 0,
      failed: 0,
      dead_lettered: 1,
      total: 1,
    });
    expect(db.withTenantContext).toHaveBeenCalledTimes(2);
    expect(db.withTenantContext.mock.calls.map(([organizationId]) => organizationId))
      .toEqual([22, 33]);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('organization-scoped recovery binds every terminalize/select query to the tenant', async () => {
    db.withTenantContext = jest.fn((_organizationId, callback) => callback());
    db.query.mockImplementation(sql => (
      /SELECT wd\.id AS delivery_id/.test(sql)
        ? Promise.resolve([[]])
        : Promise.resolve([{ affectedRows: 0 }])
    ));

    await expect(webhookService.processRetries(42)).resolves.toEqual({
      succeeded: 0,
      queued: 0,
      failed: 0,
      dead_lettered: 0,
      total: 0,
    });
    expect(db.query).toHaveBeenCalledTimes(4);
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).toMatch(/w\.id IS NULL OR w\.organization_id = \?|w\.organization_id = \?/);
      expect(params).toEqual([42]);
    }
    expect(https.request).not.toHaveBeenCalled();
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
  test('an inactive owner cannot redeliver or probe its saved destination', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.query.mockResolvedValueOnce([[]]);

    await expect(webhookService.redeliverDeadLetter(31, 42)).resolves.toEqual({
      status: 'dead_letter',
      reason: 'organization_inactive',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(
      /FROM organizations[\s\S]*status = 'active'[\s\S]*deleted_at IS NULL/,
    );
    expect(db.query.mock.calls[0][1]).toEqual([42]);
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('returns not_found for unknown delivery', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await webhookService.redeliverDeadLetter(999, 42);
    expect(result.status).toBe('not_found');
    expect(db.query.mock.calls[0][1]).toEqual([999, 42]);
  });

  test('same-id dead letter from another organization cannot be redelivered', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 31,
        event_name: 'payment.received',
        payload: JSON.stringify({ data: { amount: 100 } }),
        webhook_id: 10,
        webhook_organization_id: 99,
        url: 'https://8.8.8.8/foreign',
      },
    ]]);

    await expect(webhookService.redeliverDeadLetter(31, 42)).resolves.toEqual({
      status: 'not_found',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('redelivery makes an unsafe legacy destination terminal without opening a socket', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 31,
          event_name: 'payment.received',
          payload: JSON.stringify({ data: { amount: 100 } }),
          webhook_id: 10,
          webhook_organization_id: 42,
          organization_epoch: 7,
          url: 'https://127.0.0.1/private',
          target_url: 'https://127.0.0.1/private',
          secret_encrypted: null,
          max_retries: 5,
          timeout_seconds: 5,
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(webhookService.redeliverDeadLetter(31, 42)).resolves.toMatchObject({
      status: 'dead_letter',
      error: expect.any(String),
    });
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE webhook_deliveries/);
    expect(db.query.mock.calls[1][1]).toEqual([31, 10]);
  });

  test('manual redelivery cannot resurrect a dead letter from an older organization epoch', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 31,
        event_name: 'payment.received',
        payload: '{}',
        webhook_id: 10,
        webhook_organization_id: 42,
        organization_epoch: 5,
        url: 'https://8.8.8.8/hook',
        target_url: 'https://8.8.8.8/hook',
      },
    ]]);

    await expect(webhookService.redeliverDeadLetter(31, 42)).resolves.toEqual({
      status: 'dead_letter',
      webhook_id: 10,
      reason: 'organization_lifecycle_changed',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('resets and queues a dead letter without inline redelivery', async () => {
    const dlRow = {
      id: 31, event_name: 'payment.received',
      payload: JSON.stringify({ data: { amount: 100 } }),
      webhook_id: 10, webhook_organization_id: 42, url: 'https://8.8.8.8/hook',
      organization_epoch: 7,
      target_url: 'https://8.8.8.8/hook',
      secret_encrypted: null, max_retries: 5, timeout_seconds: 5,
    };
    db.query
      .mockResolvedValueOnce([[dlRow]])           // SELECT dead-letter row
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE to retrying

    const result = await webhookService.redeliverDeadLetter(31, 42);
    expect(result).toEqual({ status: 'pending', delivery_id: 31 });
    const [resetSql, resetParams] = db.query.mock.calls[1];
    expect(resetSql).toMatch(/SET status = 'retrying', attempt_number = 0, recovery_count = 0/);
    expect(resetSql).toMatch(/http_status_code = NULL, response_body = NULL/);
    expect(resetSql).toMatch(/response_time_ms = NULL, delivered_at = NULL/);
    expect(resetSql).toMatch(/revoked_at = NULL/);
    expect(resetSql).toMatch(/created_at = NOW\(\)/);
    expect(resetSql).toMatch(/WHERE id = \? AND webhook_id = \? AND status = 'dead_letter'/);
    expect(resetParams).toEqual([31, 10]);
    expect(jobQueue.add).toHaveBeenCalledWith(
      'webhook-delivery',
      { deliveryId: 31, organizationId: 42 },
      expect.objectContaining({ jobId: 'webhook-delivery-42-31' }),
    );
    expect(https.request).not.toHaveBeenCalled();
  });

  test('does not enqueue when another worker changes the dead letter before the reset', async () => {
    const dlRow = {
      id: 31, event_name: 'payment.received', payload: '{}',
      webhook_id: 10, webhook_organization_id: 42, url: 'https://8.8.8.8/hook',
      organization_epoch: 7, target_url: 'https://8.8.8.8/hook',
      secret_encrypted: null, max_retries: 5, timeout_seconds: 5,
    };
    db.query
      .mockResolvedValueOnce([[dlRow]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(webhookService.redeliverDeadLetter(31, 42)).resolves.toEqual({
      status: 'not_found',
    });
    expect(db.query.mock.calls[1][0]).toMatch(/status = 'dead_letter'/);
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });
});

// =============================================================================
// processRetries() — alias for retry processing
// =============================================================================
describe('processRetries() (public API)', () => {
  test('returns zero counts when no pending deliveries', async () => {
    db.query.mockImplementation(sql => (
      /SELECT wd\.id AS delivery_id/.test(sql)
        ? Promise.resolve([[]])
        : Promise.resolve([{ affectedRows: 0 }])
    ));
    const result = await webhookService.processRetries();
    expect(result).toHaveProperty('succeeded');
    expect(result).toHaveProperty('total');
  });
});
