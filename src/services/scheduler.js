// =============================================================================
// FireISP 5.0 — Cron Scheduler Service
// =============================================================================
// Reads scheduled_tasks from the database, evaluates cron expressions, acquires
// distributed locks, and dispatches tasks via the taskRunner service.
// =============================================================================

const cron = require('node-cron');
const db = require('../config/database');
const taskRunner = require('./taskRunner');

/** @type {Map<string, import('node-cron').ScheduledTask>} */
const activeCronJobs = new Map();

/** Hostname used as lock owner for distributed locking. */
const LOCK_OWNER = process.env.HOSTNAME || `node-${process.pid}`;

/**
 * Attempt to acquire a distributed lock on a scheduled task row.
 * Returns true if the lock was acquired, false otherwise.
 */
async function acquireLock(taskId) {
  const [result] = await db.query(
    `UPDATE scheduled_tasks
        SET locked_by = ?, locked_at = NOW()
      WHERE id = ?
        AND (locked_by IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE))`,
    [LOCK_OWNER, taskId],
  );
  return result.affectedRows === 1;
}

/**
 * Release the distributed lock on a scheduled task row.
 */
async function releaseLock(taskId) {
  await db.query(
    'UPDATE scheduled_tasks SET locked_by = NULL, locked_at = NULL WHERE id = ? AND locked_by = ?',
    [taskId, LOCK_OWNER],
  );
}

/**
 * Execute a single scheduled task with locking, status tracking, and error handling.
 */
async function executeTask(task) {
  const locked = await acquireLock(task.id);
  if (!locked) return; // Another node is running this task

  try {
    await db.query(
      'UPDATE scheduled_tasks SET status = ?, last_run_at = NOW() WHERE id = ?',
      ['running', task.id],
    );

    const result = await taskRunner.runTask(task.task_name, task.organization_id);

    await db.query(
      'UPDATE scheduled_tasks SET status = ?, last_result = ? WHERE id = ?',
      ['completed', JSON.stringify(result), task.id],
    );
  } catch (err) {
    await db.query(
      'UPDATE scheduled_tasks SET status = ?, last_result = ? WHERE id = ?',
      ['failed', JSON.stringify({ error: err.message }), task.id],
    );
    console.error(`Scheduler: task "${task.task_name}" failed:`, err.message);
  } finally {
    await releaseLock(task.id);
  }
}

/**
 * Load enabled scheduled tasks from the database and register cron jobs.
 * Stops any previously registered jobs before re-registering.
 */
async function loadAndScheduleTasks() {
  // Stop all existing cron jobs
  for (const [, job] of activeCronJobs) {
    job.stop();
  }
  activeCronJobs.clear();

  const [tasks] = await db.query(
    'SELECT * FROM scheduled_tasks WHERE is_enabled = TRUE AND cron_expression IS NOT NULL',
  );

  for (const task of tasks) {
    if (!cron.validate(task.cron_expression)) {
      console.error(`Scheduler: invalid cron expression for "${task.task_name}": ${task.cron_expression}`);
      continue;
    }

    const job = cron.schedule(task.cron_expression, () => {
      executeTask(task).catch(err => {
        console.error(`Scheduler: unhandled error in "${task.task_name}":`, err.message);
      });
    });

    activeCronJobs.set(task.task_name, job);
  }

  return tasks.length;
}

/**
 * Start the scheduler — loads tasks and begins cron evaluation.
 */
async function start() {
  const count = await loadAndScheduleTasks();
  console.log(`  ✓ Scheduler started (${count} task${count !== 1 ? 's' : ''} registered)`);
  return count;
}

/**
 * Stop all cron jobs and release any locks held by this node.
 */
async function stop() {
  for (const [, job] of activeCronJobs) {
    job.stop();
  }
  activeCronJobs.clear();

  try {
    await db.query(
      'UPDATE scheduled_tasks SET locked_by = NULL, locked_at = NULL WHERE locked_by = ?',
      [LOCK_OWNER],
    );
  } catch (_err) {
    // Database may already be closed during shutdown
  }
}

/**
 * Return the number of currently active cron jobs.
 */
function getActiveJobCount() {
  return activeCronJobs.size;
}

module.exports = { start, stop, loadAndScheduleTasks, executeTask, acquireLock, releaseLock, getActiveJobCount, LOCK_OWNER };
