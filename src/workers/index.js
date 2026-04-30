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

  // ---- AI triage ----------------------------------------------------------
  jobQueue.process('ai-triage', async (job) => {
    const aiReplyService = require('../services/aiReplyService');
    const { orgId, ticketId, channel, inboundText, contractId } = job.data;
    logger.info({ orgId, ticketId, channel }, 'Worker: running AI triage');
    return aiReplyService.generate({ orgId, ticketId, channel, inboundText, contractId });
  });

  // ---- AI backfill embeddings ---------------------------------------------
  // Re-indexes phrase library + resolved tickets into the vector store when
  // the phrase library changes.  Skipped when vector retrieval is disabled
  // (VECTOR_RETRIEVAL_ENABLED !== 'true').
  jobQueue.process('ai-backfill-embeddings', async (job) => {
    const { orgId } = job.data;

    if (process.env.VECTOR_RETRIEVAL_ENABLED !== 'true') {
      logger.debug({ orgId }, 'Worker: vector retrieval disabled — skipping backfill');
      return { skipped: true, reason: 'vector_retrieval_disabled' };
    }

    logger.info({ orgId }, 'Worker: running AI embedding backfill');
    const phraseLibraryService = require('../services/phraseLibraryService');
    const db = require('../config/database');

    // Re-embed phrase library for the org
    const { data: phrases } = await phraseLibraryService.listPhrases(orgId, { limit: 1000 });
    logger.debug({ orgId, count: phrases.length }, 'Worker: backfill — phrase library loaded');

    // Re-embed resolved tickets (context for future retrieval-augmented drafts)
    const [tickets] = await db.query(
      `SELECT id, subject, description FROM tickets
       WHERE organization_id = ? AND status = 'resolved' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 500`,
      [orgId],
    );
    logger.debug({ orgId, count: tickets.length }, 'Worker: backfill — resolved tickets loaded');

    // Actual vector upsert using ChromaDB.
    const vectorStoreService = require('../services/vectorStoreService');
    const llmProviderService = require('../services/llmProviderService');

    // Get active provider for this org
    const AiPolicy = require('../models/AiPolicy');
    const policy = await AiPolicy.findByOrgId(orgId);
    if (!policy.active_provider_id) {
      return { skipped: true, reason: 'no_active_provider' };
    }
    const activeProviderId = policy.active_provider_id;

    let phrasesIndexed = 0;
    let ticketsIndexed = 0;

    // --- Embed + upsert phrases per locale ---
    const phrasesByLocale = {};
    for (const p of phrases) {
      if (!phrasesByLocale[p.locale]) phrasesByLocale[p.locale] = [];
      phrasesByLocale[p.locale].push(p);
    }

    for (const [locale, localePhrases] of Object.entries(phrasesByLocale)) {
      const collection = `phrases_${orgId}_${locale.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      await vectorStoreService.ensureCollection(collection);

      const ids = [], embeddings = [], documents = [], metadatas = [];
      for (const phrase of localePhrases) {
        try {
          const embedding = await llmProviderService.embed(phrase.text, activeProviderId);
          ids.push(`phrase_${phrase.id}`);
          embeddings.push(embedding);
          documents.push(phrase.text);
          metadatas.push({ phrase_id: phrase.id, category: phrase.category, locale });
          phrasesIndexed += 1;
        } catch (err) {
          logger.warn({ orgId, phraseId: phrase.id, err: err.message }, 'Worker: backfill — embed failed for phrase');
        }
      }

      if (ids.length > 0) {
        await vectorStoreService.upsertDocuments({ collection, ids, embeddings, documents, metadatas });
      }
    }

    // --- Embed + upsert resolved tickets ---
    const ticketCollection = `tickets_${orgId}`;
    await vectorStoreService.ensureCollection(ticketCollection);

    const tIds = [], tEmbeds = [], tDocs = [], tMeta = [];
    for (const ticket of tickets) {
      const text = [ticket.subject, ticket.description].filter(Boolean).join('\n');
      try {
        const embedding = await llmProviderService.embed(text, activeProviderId);
        tIds.push(`ticket_${ticket.id}`);
        tEmbeds.push(embedding);
        tDocs.push(text);
        tMeta.push({ ticket_id: ticket.id, subject: ticket.subject });
        ticketsIndexed += 1;
      } catch (err) {
        logger.warn({ orgId, ticketId: ticket.id, err: err.message }, 'Worker: backfill — embed failed for ticket');
      }
    }

    if (tIds.length > 0) {
      await vectorStoreService.upsertDocuments({ collection: ticketCollection, ids: tIds, embeddings: tEmbeds, documents: tDocs, metadatas: tMeta });
    }

    return { skipped: false, orgId, phrasesIndexed, ticketsIndexed };
  });

  // ---- AI cost rollup -----------------------------------------------------
  // Daily job: aggregate ai_reply_logs.cost_usd per org for the current
  // calendar month and persist into organization_quotas.ai_cost_month_usd.
  // Resets the counter when a new month is detected.
  jobQueue.process('ai-cost-rollup', async (job) => {
    const db = require('../config/database');
    const { organizationId = null } = job.data;

    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    // Build org filter — process a single org or all orgs
    let orgCondition = '';
    const params = [currentMonth];
    if (organizationId !== null) {
      orgCondition = 'AND organization_id = ?';
      params.push(organizationId);
    }

    logger.info({ organizationId, currentMonth }, 'Worker: running AI cost rollup');

    // Aggregate cost_usd per org for the current calendar month
    const [rows] = await db.query(
      `SELECT organization_id,
              SUM(COALESCE(cost_usd, 0)) AS total_cost_usd
       FROM ai_reply_logs
       WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
         ${orgCondition}
       GROUP BY organization_id`,
      params,
    );

    if (rows.length === 0) {
      logger.debug({ organizationId, currentMonth }, 'Worker: no AI reply logs for period');
      return { updated: 0, month: currentMonth };
    }

    // Upsert each org's monthly cost total.
    // total_cost_usd is the full month aggregate from the SELECT above, so we
    // always overwrite (no addition needed — this handles both same-month
    // refresh and month-boundary reset correctly).
    for (const row of rows) {
      await db.query(
        `INSERT INTO organization_quotas (organization_id, ai_cost_month_usd, ai_cost_rollup_month)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           ai_cost_month_usd    = VALUES(ai_cost_month_usd),
           ai_cost_rollup_month = VALUES(ai_cost_rollup_month)`,
        [row.organization_id, row.total_cost_usd, currentMonth],
      );
    }

    logger.info({ organizationId, currentMonth, orgsUpdated: rows.length }, 'Worker: AI cost rollup complete');
    return { updated: rows.length, month: currentMonth };
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
