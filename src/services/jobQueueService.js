// =============================================================================
// FireISP 5.0 — Job Queue Service
// =============================================================================
// Provides an async job queue interface that works with or without Redis/BullMQ.
// When REDIS_URL is set and bullmq is installed, uses BullMQ for distributed
// job processing. Otherwise falls back to a simple in-process queue.
//
// Usage:
//   const jobQueue = require('./jobQueueService');
//   await jobQueue.add('send-email', { to: 'a@b.com', subject: 'Hello' });
//   jobQueue.process('send-email', async (job) => { ... });
// =============================================================================

const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// In-process queue (fallback when BullMQ is not available)
// ---------------------------------------------------------------------------
class InProcessQueue {
  constructor() {
    /** @type {Map<string, Function>} */
    this.handlers = new Map();
    this.running = 0;
    this.maxConcurrency = parseInt(process.env.JOB_QUEUE_CONCURRENCY || '5', 10);
  }

  async add(name, data, _opts = {}) {
    const handler = this.handlers.get(name);
    if (!handler) {
      logger.warn({ name }, 'No handler registered for job — queuing skipped');
      return { id: `local-${Date.now()}`, name, status: 'no-handler' };
    }

    const jobId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = { id: jobId, name, data, attempts: 0 };

    // Execute asynchronously
    setTimeout(async () => {
      if (this.running >= this.maxConcurrency) {
        // Simple backpressure — wait until a slot is free
        await new Promise(resolve => {
          const interval = setInterval(() => {
            if (this.running < this.maxConcurrency) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        });
      }

      this.running++;
      try {
        await handler(job);
        logger.debug({ jobId, name }, 'Job completed');
      } catch (err) {
        logger.error({ err, jobId, name }, 'Job failed');
      } finally {
        this.running--;
      }
    });

    return { id: jobId, name, status: 'queued' };
  }

  process(name, handler) {
    this.handlers.set(name, handler);
  }

  async close() {
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
let instance = null;

function createQueue() {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      // Only require bullmq if REDIS_URL is set — it's an optional dependency
      const { Queue, Worker } = require('bullmq');
      const connection = { url: redisUrl };

      const queues = new Map();
      const workers = new Map();

      return {
        async add(name, data, opts = {}) {
          if (!queues.has(name)) {
            queues.set(name, new Queue(name, { connection }));
          }
          const q = queues.get(name);
          const job = await q.add(name, data, {
            attempts: opts.attempts || 3,
            backoff: opts.backoff || { type: 'exponential', delay: 1000 },
            ...opts,
          });
          return { id: job.id, name, status: 'queued' };
        },

        process(name, handler) {
          if (workers.has(name)) return;
          const w = new Worker(name, async (job) => handler(job), {
            connection,
            concurrency: parseInt(process.env.JOB_QUEUE_CONCURRENCY || '5', 10),
          });
          w.on('failed', (job, err) => {
            logger.error({ err, jobId: job?.id, name }, 'BullMQ job failed');
          });
          workers.set(name, w);
        },

        async close() {
          for (const [, w] of workers) await w.close();
          for (const [, q] of queues) await q.close();
        },
      };
    } catch (_err) {
      logger.info('bullmq not installed — using in-process job queue');
    }
  }

  logger.info('Using in-process job queue (set REDIS_URL + install bullmq for distributed queue)');
  return new InProcessQueue();
}

function getQueue() {
  if (!instance) {
    instance = createQueue();
  }
  return instance;
}

module.exports = {
  add: (name, data, opts) => getQueue().add(name, data, opts),
  process: (name, handler) => getQueue().process(name, handler),
  close: () => getQueue().close(),
};
