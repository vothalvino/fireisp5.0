// =============================================================================
// FireISP 5.0 — Scheduler Service
// =============================================================================
// Loads enabled scheduled_tasks from the database, schedules them with
// node-cron, and dispatches each run through taskRunner.
// =============================================================================

const cron = require('node-cron');
const db = require('../config/database');
const taskRunner = require('./taskRunner');
const cacheService = require('./cacheService');
const logger = require('../utils/logger').child({ service: 'scheduler' });

const jobs = new Map();

/**
 * Attempt to acquire a distributed lock for a task using the cache service.
 * Returns true if this node acquired the lock, false otherwise.
 * Falls back to always returning true when Redis is not available (single-node).
 *
 * Note: This is not fully atomic without Redis SETNX. When using the in-memory
 * fallback (single node), this is safe. With Redis, a small race window exists
 * between get and set; for cron tasks running at most once per minute, this is
 * acceptable. For sub-second scheduling, use Redis SET NX directly via ioredis.
 */
async function acquireLock(taskName, ttlSeconds = 300) {
  const key = `scheduler:lock:${taskName}`;
  try {
    // Try to get existing lock
    const existing = await cacheService.get(key);
    if (existing) return false;

    // Set the lock with TTL — this is not atomic without Redis SETNX,
    // but is sufficient for reducing duplicate runs
    await cacheService.set(key, { node: process.pid, lockedAt: Date.now() }, ttlSeconds);
    return true;
  } catch (_err) {
    // If cache fails, allow execution (single-node fallback)
    return true;
  }
}

/**
 * Release a distributed lock for a task.
 */
async function releaseLock(taskName) {
  const key = `scheduler:lock:${taskName}`;
  try {
    await cacheService.del(key);
  } catch (_err) {
    // Best effort
  }
}

/**
 * Load all enabled tasks from the DB and schedule them.
 */
async function start() {
  const [tasks] = await db.query(
    'SELECT * FROM scheduled_tasks WHERE is_enabled = 1 AND cron_expression IS NOT NULL',
  );

  for (const task of tasks) {
    schedule(task);
  }

  logger.info({ taskCount: tasks.length }, 'Scheduler started');
}

/**
 * Schedule a single task using its cron_expression.
 */
function schedule(task) {
  if (!cron.validate(task.cron_expression)) {
    logger.warn({ taskName: task.task_name, cronExpression: task.cron_expression }, 'Invalid cron expression for task');
    return;
  }

  const job = cron.schedule(task.cron_expression, async () => {
    // Distributed lock: only one node should execute each task
    const acquired = await acquireLock(task.task_name);
    if (!acquired) {
      return; // Another node is running this task
    }

    try {
      await db.query(
        'UPDATE scheduled_tasks SET last_status = ?, last_run_at = NOW() WHERE id = ?',
        ['running', task.id],
      );

      await taskRunner.runTask(task.task_name, task.organization_id);
      await taskRunner.markTaskRun(task.task_name);
    } catch (err) {
      logger.error({ err, taskName: task.task_name }, 'Scheduler error on task');
      await db.query(
        'UPDATE scheduled_tasks SET last_status = ? WHERE id = ?',
        ['failed', task.id],
      ).catch(() => {});
    } finally {
      await releaseLock(task.task_name);
    }
  });

  jobs.set(task.task_name, job);
}

/**
 * Stop all scheduled cron jobs.
 */
function stop() {
  for (const [, job] of jobs) {
    job.stop();
  }
  jobs.clear();
  logger.info('Scheduler stopped');
}

/**
 * Return status of all registered jobs.
 */
function getStatus() {
  const result = [];
  for (const [name] of jobs) {
    result.push({ task_name: name, scheduled: true });
  }
  return result;
}

module.exports = { start, stop, getStatus };
