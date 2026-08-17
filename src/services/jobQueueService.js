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

const JOB_QUEUE_ADD_TIMEOUT_MS = Math.max(
  250,
  Math.min(10000, parseInt(process.env.JOB_QUEUE_ADD_TIMEOUT_MS || '2500', 10) || 2500),
);

function parseRedisConnectionOptions(rawUrl, overrides = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch (_) {
    throw Object.assign(new Error('REDIS_URL is not a valid Redis URL.'), {
      code: 'INVALID_REDIS_URL',
    });
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw Object.assign(new Error('REDIS_URL must use redis:// or rediss://.'), {
      code: 'INVALID_REDIS_URL',
    });
  }
  const databasePath = parsed.pathname.replace(/^\//, '');
  if (databasePath && !/^\d+$/.test(databasePath)) {
    throw Object.assign(new Error('REDIS_URL database must be a non-negative integer.'), {
      code: 'INVALID_REDIS_URL',
    });
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) {
    throw Object.assign(new Error('REDIS_URL must include a host.'), {
      code: 'INVALID_REDIS_URL',
    });
  }
  const options = {
    host,
    port: parsed.port ? Number(parsed.port) : 6379,
    db: databasePath ? Number(databasePath) : 0,
    ...(parsed.username && { username: decodeURIComponent(parsed.username) }),
    ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
    ...(parsed.protocol === 'rediss:' && { tls: { servername: host } }),
    ...overrides,
  };
  return options;
}

function withAddDeadline(promise, name) {
  let timer;
  // Attach rejection handling to the original command before racing it. A
  // command may settle after the application deadline during Redis recovery;
  // deterministic caller jobIds make that harmless and this prevents an
  // unhandled late rejection.
  const guarded = Promise.resolve(promise).catch(err => { throw err; });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Queue add deadline exceeded for ${name}`);
      err.code = 'JOB_QUEUE_ADD_TIMEOUT';
      reject(err);
    }, JOB_QUEUE_ADD_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([guarded, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Well-known queue names — used for stats even before any jobs are added
// ---------------------------------------------------------------------------
const QUEUE_NAMES = ['scheduled-task', 'webhook-delivery', 'trap-forwarding-delivery', 'sms-send', 'cfdi-stamp', 'config-backup', 'ai-triage', 'ai-backfill-embeddings', 'ai-cost-rollup'];

// ---------------------------------------------------------------------------
// In-process queue (fallback when BullMQ is not available)
// ---------------------------------------------------------------------------
class InProcessQueue {
  constructor() {
    /** @type {Map<string, Function>} */
    this.handlers = new Map();
    this.running = 0;
    this.maxConcurrency = parseInt(process.env.JOB_QUEUE_CONCURRENCY || '5', 10);
    this.pending = [];
    this.activeByName = new Map();
    this.knownJobIds = new Set();
    this.drainScheduled = false;
    this.maxPending = Math.max(10, Math.min(10000, parseInt(process.env.JOB_QUEUE_MAX_PENDING || '1000', 10) || 1000));
    this.trapForwardingCapacity = Math.max(
      10,
      Math.min(1000, parseInt(process.env.SNMP_TRAP_LOCAL_QUEUE_CAPACITY || '100', 10) || 100),
    );
  }

  async add(name, data, _opts = {}) {
    const handler = this.handlers.get(name);
    if (!handler) {
      logger.warn({ name }, 'No handler registered for job — queuing skipped');
      return { id: `local-${Date.now()}`, name, status: 'no-handler' };
    }

    const requestedJobId = typeof _opts.jobId === 'string' && _opts.jobId
      ? _opts.jobId
      : null;
    if (requestedJobId && this.knownJobIds.has(requestedJobId)) {
      return { id: requestedJobId, name, status: 'queued', deduplicated: true };
    }

    const pendingForName = this.pending.reduce(
      (count, job) => count + (job.name === name ? 1 : 0),
      this.activeByName.get(name) || 0,
    );
    const capacity = name === 'trap-forwarding-delivery'
      ? this.trapForwardingCapacity
      : this.maxPending;
    if (this.pending.length >= this.maxPending || pendingForName >= capacity) {
      logger.warn({ name, capacity }, 'In-process job queue capacity reached');
      // Only queues with an already-committed database outbox may turn local
      // overflow into a successful durable-pending result. Other callers must
      // see a failure instead of silently losing their job.
      if (name === 'trap-forwarding-delivery' || name === 'webhook-delivery') {
        return { id: null, name, status: 'durable-pending' };
      }
      throw Object.assign(new Error(`In-process queue capacity reached for ${name}`), {
        code: 'JOB_QUEUE_CAPACITY',
      });
    }

    const jobId = requestedJobId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.knownJobIds.add(jobId);
    this.pending.push({ id: jobId, name, data, attemptsMade: 0, opts: _opts, handler });
    this.scheduleDrain();

    return { id: jobId, name, status: 'queued' };
  }

  scheduleDrain() {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    globalThis.setImmediate(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  drain() {
    while (this.running < this.maxConcurrency && this.pending.length) {
      const job = this.pending.shift();
      this.running++;
      this.activeByName.set(job.name, (this.activeByName.get(job.name) || 0) + 1);
      Promise.resolve()
        .then(() => job.handler(job))
        .then(() => logger.debug({ jobId: job.id, name: job.name }, 'Job completed'))
        .catch(err => logger.error({ err, jobId: job.id, name: job.name }, 'Job failed'))
        .finally(() => {
          this.knownJobIds.delete(job.id);
          this.running--;
          const remaining = (this.activeByName.get(job.name) || 1) - 1;
          if (remaining > 0) this.activeByName.set(job.name, remaining);
          else this.activeByName.delete(job.name);
          this.scheduleDrain();
        });
    }
  }

  process(name, handler) {
    this.handlers.set(name, handler);
  }

  async close() {
    this.handlers.clear();
    this.pending.length = 0;
    this.knownJobIds.clear();
  }

  async getStats() {
    const counts = new Map();
    for (const job of this.pending) counts.set(job.name, (counts.get(job.name) || 0) + 1);
    return {
      mode: 'in-process',
      queues: [...counts].map(([name, waiting]) => ({ name, waiting })),
      active: this.running,
      pending: this.pending.length,
    };
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
      // Producers sit on ingestion/request paths. Never let ioredis retain an
      // unbounded offline command queue or retry an add for minutes: durable
      // database outboxes recover these jobs. Workers need BullMQ's required
      // blocking-connection retry policy and therefore use a separate config.
      const producerConnection = parseRedisConnectionOptions(redisUrl, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        commandTimeout: 2000,
        retryStrategy: attempt => Math.min(1000, Math.max(100, attempt * 100)),
      });
      const workerConnection = parseRedisConnectionOptions(redisUrl, {
        maxRetriesPerRequest: null,
      });

      const queues = new Map();
      const workers = new Map();
      let producerTimeouts = 0;
      let producerFailures = 0;

      return {
        async add(name, data, opts = {}) {
          if (!queues.has(name)) {
            queues.set(name, new Queue(name, { connection: producerConnection }));
          }
          const q = queues.get(name);
          let job;
          try {
            const addPromise = q.add(name, data, {
              attempts: opts.attempts || 3,
              backoff: opts.backoff || { type: 'exponential', delay: 1000 },
              removeOnComplete: opts.removeOnComplete ?? { age: 3600, count: 1000 },
              removeOnFail: opts.removeOnFail ?? { age: 86400, count: 1000 },
              ...opts,
            });
            const durableIdempotent = (name === 'trap-forwarding-delivery'
                || name === 'webhook-delivery')
              && typeof opts.jobId === 'string' && opts.jobId.length > 0;
            job = durableIdempotent
              ? await withAddDeadline(addPromise, name)
              : await addPromise;
          } catch (err) {
            producerFailures++;
            if (err?.code === 'JOB_QUEUE_ADD_TIMEOUT') producerTimeouts++;
            throw err;
          }
          return { id: job.id, name, status: 'queued' };
        },

        process(name, handler) {
          if (workers.has(name)) return;
          const w = new Worker(name, async (job) => handler(job), {
            connection: workerConnection,
            concurrency: Math.max(1, Math.min(
              100,
              parseInt(process.env.JOB_QUEUE_CONCURRENCY || '5', 10) || 5,
            )),
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

        async getStats() {
          try {
            const stats = await Promise.all(QUEUE_NAMES.map(async (name) => {
              if (!queues.has(name)) {
                queues.set(name, new Queue(name, { connection: producerConnection }));
              }
              const counts = await queues.get(name).getJobCounts(
                'waiting', 'active', 'completed', 'failed', 'delayed',
              );
              return { name, ...counts };
            }));
            return {
              mode: 'bullmq',
              queues: stats,
              producer_add_timeouts: producerTimeouts,
              producer_add_failures: producerFailures,
            };
          } catch (_err) {
            return {
              mode: 'bullmq',
              queues: [],
              error: 'Stats unavailable',
              producer_add_timeouts: producerTimeouts,
              producer_add_failures: producerFailures,
            };
          }
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
  getStats: () => getQueue().getStats(),
  QUEUE_NAMES,
  JOB_QUEUE_ADD_TIMEOUT_MS,
  parseRedisConnectionOptions,
};
