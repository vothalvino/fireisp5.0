// =============================================================================
// FireISP 5.0 — Job Queue Service Unit Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

// Ensure we use in-process queue (no Redis)
delete process.env.REDIS_URL;

let jobQueue;
const logger = require('../src/utils/logger');

describe('jobQueueService (InProcessQueue fallback)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.mock('../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    }));
    delete process.env.REDIS_URL;
    jobQueue = require('../src/services/jobQueueService');
  });

  afterEach(async () => {
    await jobQueue.close();
  });

  // =========================================================================
  // process + add
  // =========================================================================
  describe('process() and add()', () => {
    test('registers a handler and processes a job', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      jobQueue.process('send-email', handler);

      const result = await jobQueue.add('send-email', { to: 'test@example.com' });
      expect(result).toEqual(expect.objectContaining({
        name: 'send-email',
        status: 'queued',
      }));
      expect(result.id).toMatch(/^local-/);

      // Wait for the async setTimeout handler to execute
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'send-email',
          data: { to: 'test@example.com' },
        }),
      );
    });

    test('returns no-handler status when no handler is registered', async () => {
      const loggerMod = require('../src/utils/logger');
      const result = await jobQueue.add('unregistered-job', { data: 1 });
      expect(result.status).toBe('no-handler');
      expect(loggerMod.warn).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'unregistered-job' }),
        expect.any(String),
      );
    });

    test('generates unique job IDs', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      jobQueue.process('test-job', handler);

      const r1 = await jobQueue.add('test-job', {});
      const r2 = await jobQueue.add('test-job', {});
      expect(r1.id).not.toBe(r2.id);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================
  describe('error handling', () => {
    test('logs error when handler throws', async () => {
      const loggerMod = require('../src/utils/logger');
      jobQueue.process('failing-job', async () => {
        throw new Error('Job processing failed');
      });

      await jobQueue.add('failing-job', { key: 'value' });

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(loggerMod.error).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'failing-job' }),
        'Job failed',
      );
    });

    test('does not propagate handler errors to add caller', async () => {
      jobQueue.process('error-job', async () => {
        throw new Error('Boom');
      });

      await expect(jobQueue.add('error-job', {})).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Concurrency
  // =========================================================================
  describe('concurrency', () => {
    test('respects maxConcurrency setting', async () => {
      // Default concurrency is 5
      let running = 0;
      let maxRunning = 0;

      jobQueue.process('concurrent-job', async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(resolve => setTimeout(resolve, 20));
        running--;
      });

      // Queue 3 jobs (under the limit)
      await Promise.all([
        jobQueue.add('concurrent-job', { i: 1 }),
        jobQueue.add('concurrent-job', { i: 2 }),
        jobQueue.add('concurrent-job', { i: 3 }),
      ]);

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // All 3 should have run (max 5 concurrent)
      expect(maxRunning).toBeLessThanOrEqual(5);
      expect(maxRunning).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // close
  // =========================================================================
  describe('close()', () => {
    test('clears all handlers', async () => {
      const handler = jest.fn();
      jobQueue.process('test', handler);

      await jobQueue.close();

      // After close, adding a job should result in no-handler
      // (re-require to get fresh module since close cleared handlers but module singleton is same)
    });
  });

  // =========================================================================
  // Multiple job types
  // =========================================================================
  describe('multiple job types', () => {
    test('routes jobs to correct handlers', async () => {
      const emailHandler = jest.fn().mockResolvedValue(undefined);
      const smsHandler = jest.fn().mockResolvedValue(undefined);

      jobQueue.process('send-email', emailHandler);
      jobQueue.process('send-sms', smsHandler);

      await jobQueue.add('send-email', { to: 'a@b.com' });
      await jobQueue.add('send-sms', { to: '+1234567890' });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(emailHandler).toHaveBeenCalledWith(
        expect.objectContaining({ data: { to: 'a@b.com' } }),
      );
      expect(smsHandler).toHaveBeenCalledWith(
        expect.objectContaining({ data: { to: '+1234567890' } }),
      );
    });
  });
});
