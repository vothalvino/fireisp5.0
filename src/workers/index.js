// =============================================================================
// FireISP 5.0 — BullMQ Worker Registry
// =============================================================================
// Registers handlers for all named job queues. When REDIS_URL is set the
// handlers are backed by BullMQ Workers; otherwise the InProcessQueue fallback
// handles them in the same process without any external dependency.
//
// Call registerWorkers() once at server startup (before accepting traffic).
// Call close() on graceful shutdown (handled via jobQueueService.close()).
// =============================================================================

const jobQueue = require('../services/jobQueueService');
const logger = require('../utils/logger').child({ service: 'workers' });

let registered = false;

/**
 * Register all job handlers.  Idempotent — safe to call multiple times.
 */
function registerWorkers() {
  if (registered) return;
  registered = true;

  // Lazy-require each service to break any potential startup-time circular deps.

  // ---- Generic scheduled-task dispatcher ----------------------------------
  jobQueue.process('scheduled-task', async (job) => {
    const taskRunner = require('../services/taskRunner');
    const { taskName, organizationId = null } = job.data;
    logger.info({ taskName, organizationId }, 'Worker: running scheduled task');
    const result = await taskRunner.runTask(taskName, organizationId);
    await taskRunner.markTaskRun(taskName).catch(() => {});
    return result;
  });

  // ---- Webhook delivery ---------------------------------------------------
  jobQueue.process('webhook-delivery', async (job) => {
    const webhookService = require('../services/webhookService');
    return webhookService.deliverForWorker(job);
  });

  // ---- SMS send -----------------------------------------------------------
  jobQueue.process('sms-send', async (job) => {
    const smsTransport = require('../services/smsTransport');
    const { logId } = job.data;
    logger.debug({ logId }, 'Worker: processing SMS');
    return smsTransport.retryLog(logId);
  });

  // ---- CFDI stamp ---------------------------------------------------------
  jobQueue.process('cfdi-stamp', async (job) => {
    const cfdiService = require('../services/cfdiService');
    const { cfdiDocumentId } = job.data;
    logger.info({ cfdiDocumentId }, 'Worker: stamping CFDI document');
    return cfdiService.stamp(cfdiDocumentId);
  });

  // ---- Config backup pull -------------------------------------------------
  jobQueue.process('config-backup', async (job) => {
    const configBackupService = require('../services/configBackupService');
    const { organizationId = null } = job.data;
    logger.info({ organizationId }, 'Worker: running config backup pull');
    return configBackupService.runNightlyBackups(organizationId);
  });

  logger.info('Job workers registered');
}

/**
 * Reset registration state.  Used in tests to allow re-registration.
 */
function _resetForTesting() {
  registered = false;
}

module.exports = { registerWorkers, _resetForTesting };
