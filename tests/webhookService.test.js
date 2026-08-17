// =============================================================================
// FireISP 5.0 — Webhook Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(),
}));

// Mock http/https to avoid real network calls
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
const dns = require('node:dns').promises;
const { EventEmitter } = require('node:events');
const jobQueue = require('../src/services/jobQueueService');
const webhookService = require('../src/services/webhookService');

describe('webhookService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Most cases exercise webhook behavior independently of the authoritative
    // primary organization lookup. Dedicated lifecycle tests run the callback.
    db.withPrimaryContext.mockResolvedValue({ active: true, epoch: 7 });
    jobQueue.add.mockResolvedValue({ id: 'durable-job', status: 'queued' });
  });

  // Helper to mock successful HTTP request
  function mockHttpSuccess(statusCode = 200, body = 'OK') {
    https.request.mockImplementation((opts, cb) => {
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

  // =========================================================================
  // dispatch
  // =========================================================================
  describe('dispatch()', () => {
    test('persists and queues matching webhooks without inline delivery', async () => {
      const webhook = {
        id: 1, organization_id: 42, url: 'https://8.8.8.8/hook', events: 'invoice.created,payment.received',
        is_enabled: 1, secret_encrypted: null, max_retries: 0, timeout_seconds: 5,
      };
      db.query
        .mockResolvedValueOnce([[webhook]])  // SELECT webhooks
        .mockResolvedValueOnce([{ insertId: 501 }]); // INSERT durable delivery

      const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
      expect(result.dispatched).toBe(1);
      expect(result.results[0]).toMatchObject({ delivery_id: 501, status: 'queued' });
      expect(jobQueue.add).toHaveBeenCalledWith(
        'webhook-delivery',
        { deliveryId: 501, organizationId: 42 },
        expect.objectContaining({ jobId: 'webhook-delivery-42-501' }),
      );
      expect(https.request).not.toHaveBeenCalled();
    });

    test('skips webhooks that do not match event', async () => {
      const webhook = {
        id: 1, organization_id: 42, url: 'https://8.8.8.8/hook', events: 'payment.received',
        is_enabled: 1, secret_encrypted: null, max_retries: 0, timeout_seconds: 5,
      };
      db.query.mockResolvedValueOnce([[webhook]]);

      const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });
      expect(result.dispatched).toBe(0);
    });

    test('matches wildcard (*) event subscriptions', async () => {
      const webhook = {
        id: 2, organization_id: 42, url: 'https://8.8.8.8/all', events: '*',
        is_enabled: 1, secret_encrypted: null, max_retries: 0, timeout_seconds: 5,
      };
      db.query
        .mockResolvedValueOnce([[webhook]])
        .mockResolvedValueOnce([{ insertId: 502 }]);

      const result = await webhookService.dispatch(42, 'any.event', {});
      expect(result.dispatched).toBe(1);
    });

    test('returns empty when no webhooks exist', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await webhookService.dispatch(42, 'test', {});
      expect(result.dispatched).toBe(0);
    });

    test('refuses device.trap generic fanout even when called directly', async () => {
      const result = await webhookService.dispatch(42, 'device.trap', {
        trap_id: 701,
        varbinds: [{ value: 'must-never-leave' }],
      });

      expect(result).toEqual({ dispatched: 0, results: [] });
      expect(db.query).not.toHaveBeenCalled();
      expect(http.request).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    });

    test('a suspended or deleted owner prevents outbox creation, queueing, and network I/O', async () => {
      db.withPrimaryContext.mockImplementation(callback => callback());
      db.query.mockResolvedValueOnce([[]]);

      await expect(webhookService.dispatch(42, 'invoice.created', { id: 1 })).resolves.toEqual({
        dispatched: 0,
        results: [],
        reason: 'organization_inactive',
      });

      expect(db.withPrimaryContext).toHaveBeenCalledWith(expect.any(Function));
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][0]).toMatch(
        /FROM organizations[\s\S]*id = \?[\s\S]*status = 'active'[\s\S]*deleted_at IS NULL/,
      );
      expect(db.query.mock.calls[0][1]).toEqual([42]);
      expect(jobQueue.add).not.toHaveBeenCalled();
      expect(http.request).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    });

    test('database selection excludes soft-deleted webhook registrations', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await webhookService.dispatch(42, 'invoice.created', {});

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/organization_id = \?/);
      expect(sql).toMatch(/is_active = 1/);
      expect(sql).toMatch(/deleted_at IS NULL/);
      expect(params).toEqual([42]);
    });

    test('caps generic webhook fan-out at 50 durable outboxes per organization event', async () => {
      const rows = Array.from({ length: 51 }, (_, index) => ({
        id: index + 1,
        organization_id: 42,
        url: `https://8.8.8.8/hook-${index + 1}`,
        events: '*',
        is_active: 1,
        deleted_at: null,
      }));
      let insertId = 700;
      db.query.mockImplementation(sql => {
        if (/SELECT \* FROM webhooks/.test(sql)) return Promise.resolve([rows]);
        if (/INSERT INTO webhook_deliveries/.test(sql)) {
          insertId += 1;
          return Promise.resolve([{ insertId }]);
        }
        throw new Error(`Unexpected generic cap SQL: ${sql}`);
      });

      const result = await webhookService.dispatch(42, 'invoice.created', { id: 1 });

      expect(result.dispatched).toBe(50);
      expect(result.results).toHaveLength(50);
      expect(jobQueue.add).toHaveBeenCalledTimes(50);
      expect(db.query.mock.calls.filter(([sql]) => /INSERT INTO webhook_deliveries/.test(sql)))
        .toHaveLength(50);
      expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY id ASC LIMIT 51/);
      expect(JSON.stringify(jobQueue.add.mock.calls)).not.toContain('hook-51');
      expect(https.request).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // deliver
  // =========================================================================
  describe('deliver()', () => {
    test('dead_letters immediately when max_retries=0 and delivery fails', async () => {
      const webhook = {
        id: 3, organization_id: 42, url: 'https://8.8.8.8/fail', events: '*',
        secret_encrypted: null, max_retries: 0, timeout_seconds: 1,
      };

      db.query.mockResolvedValue([{ insertId: 99 }]);  // delivery log insert
      mockHttpSuccess(500, 'Internal Server Error');

      const result = await webhookService.deliver(webhook, 'test', { foo: 1 });
      // max_retries=0 means no retries allowed — result is dead_letter after first attempt
      expect(result.status).toBe('dead_letter');
    });

    test.each([
      'http://8.8.8.8/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.8/hook',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/hook',
    ])('unsafe delivery target %s is terminal and never opens a socket', async (url) => {
      db.query.mockResolvedValue([{ insertId: 100 }]);

      const result = await webhookService.deliver({
        id: 9,
        organization_id: 42,
        url,
        events: '*',
        max_retries: 5,
        timeout_seconds: 5,
      }, 'invoice.created', { id: 1 });

      expect(result.status).toBe('dead_letter');
      expect(http.request).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    });

    test('delivery re-resolves and pins HTTPS to the validated public address', async () => {
      const lookup = jest.spyOn(dns, 'lookup').mockResolvedValue([
        { address: '8.8.8.8', family: 4 },
      ]);
      db.query.mockResolvedValue([{ insertId: 101 }]);
      mockHttpSuccess(204, '');

      const result = await webhookService.deliver({
        id: 10,
        organization_id: 42,
        url: 'https://hooks.example/hook',
        events: '*',
        max_retries: 0,
        timeout_seconds: 5,
      }, 'invoice.created', { id: 1 });

      expect(result.status).toBe('success');
      expect(lookup).toHaveBeenCalledTimes(1);
      const options = https.request.mock.calls[0][0];
      expect(options.agent).toBe(false);
      expect(options.lookup).toEqual(expect.any(Function));
      await expect(new Promise((resolve, reject) => {
        options.lookup('hooks.example', { family: 4 }, (err, address) => {
          if (err) reject(err);
          else resolve(address);
        });
      })).resolves.toBe('8.8.8.8');
      lookup.mockRestore();
    });

    test('an oversized endless HTTPS response is destroyed and settles without unbounded buffering', async () => {
      db.query.mockResolvedValue([{ insertId: 102 }]);
      const response = new EventEmitter();
      response.statusCode = 200;
      response.socket = { remoteAddress: '8.8.8.8' };
      response.destroy = jest.fn(error => {
        if (error) response.emit('error', error);
      });
      let requestHandle;
      https.request.mockImplementation((options, callback) => {
        expect(options.maxHeaderSize).toEqual(expect.any(Number));
        expect(options.maxHeaderSize).toBeGreaterThan(0);
        expect(options.maxHeaderSize).toBeLessThanOrEqual(65536);
        const req = new EventEmitter();
        req.write = jest.fn();
        req.end = jest.fn(() => {
          callback(response);
          global.setImmediate(() => {
            for (let index = 0; index < 512 && !response.destroy.mock.calls.length; index++) {
              response.emit('data', Buffer.alloc(4096, 0x61));
            }
          });
        });
        req.destroy = jest.fn(error => {
          if (error) req.emit('error', error);
        });
        requestHandle = req;
        return req;
      });

      const result = await webhookService.deliver({
        id: 11,
        organization_id: 42,
        url: 'https://8.8.8.8/endless',
        events: '*',
        max_retries: 0,
        timeout_seconds: 5,
      }, 'invoice.created', { id: 1 });

      expect(result.status).toBe('success');
      expect(response.destroy.mock.calls.length + requestHandle.destroy.mock.calls.length)
        .toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // processRetries delegate behaviour
  // =========================================================================
  describe('processRetries()', () => {
    test('returns zero counts when no pending deliveries', async () => {
      db.query.mockImplementation(sql => (
        /SELECT wd\.id AS delivery_id/.test(sql)
          ? Promise.resolve([[]])
          : Promise.resolve([{ affectedRows: 0 }])
      ));
      const result = await webhookService.processRetries();
      expect(result.succeeded).toBe(0);
      expect(result.total).toBe(0);
    });
  });
});
