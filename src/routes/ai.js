// =============================================================================
// FireISP 5.0 — AI Reply Assistant REST Routes (§5.1)
// =============================================================================
// Mounted at /api/v1/ai by src/app.js.
//
// All routes require:
//   • authenticate  — JWT / cookie / API-token auth
//   • orgScope      — injects req.orgId
//   • requirePermission — RBAC guard (see table below)
//
// Permission map:
//   ai.policy.read    — GET /policy, GET /logs, GET /metrics
//   ai.policy.write   — PUT /policy
//   ai.providers.read — GET /providers, GET /providers/catalog
//   ai.providers.write— POST/PUT/DELETE /providers/:id, POST /providers/:id/verify
//   ai.phrases.read   — GET /phrases, GET /forbidden-terms
//   ai.phrases.write  — POST/PUT/DELETE /phrases/:id, POST/DELETE /forbidden-terms
//   ai.reply.draft    — POST /reply/draft
//   ai.reply.send     — POST /reply/send
// =============================================================================

const { Router }   = require('express');
const { authenticate }     = require('../middleware/auth');
const { orgScope }         = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate }          = require('../middleware/validate');
const {
  updateAiPolicy,
  createAiProvider,
  updateAiProvider,
  createAiPhrase,
  updateAiPhrase,
  createForbiddenTerm,
  replyDraft,
  replySend,
  PROVIDER_KINDS,
} = require('../middleware/schemas/ai');

const AiPolicy         = require('../models/AiPolicy');
const AiProvider       = require('../models/AiProvider');
const AiReplyLog       = require('../models/AiReplyLog');
const phraseLibraryService = require('../services/phraseLibraryService');
const llmProviderService   = require('../services/llmProviderService');
const aiReplyService       = require('../services/aiReplyService');
const { encrypt }           = require('../utils/encryption');
const { NotFoundError, ValidationError } = require('../utils/errors');
const db     = require('../config/database');
const logger = require('../utils/logger').child({ service: 'routes/ai' });

const router = Router();

router.use(authenticate);
router.use(orgScope);

// =============================================================================
// Policy
// =============================================================================

/**
 * GET /api/v1/ai/policy
 * Returns the current AiPolicy row for the authenticated org.
 * When no policy exists yet, returns a safe default (chatbot off).
 */
router.get('/policy', requirePermission('ai.policy.read'), async (req, res, next) => {
  try {
    const policy = await AiPolicy.findByOrgId(req.orgId);
    res.json({ data: policy });
  } catch (err) { next(err); }
});

/**
 * PUT /api/v1/ai/policy
 * Upsert policy settings.  The admin uses this endpoint to:
 *   • flip the chatbot master switch (enabled)
 *   • choose the active provider (active_provider_id)
 *   • select per-channel toggles (enabled_channels)
 *   • change mode / tone / locale / PII-redaction
 */
router.put('/policy', requirePermission('ai.policy.write'), validate(updateAiPolicy), async (req, res, next) => {
  try {
    const policy = await AiPolicy.upsert(req.orgId, req.body);
    logger.info({ orgId: req.orgId, userId: req.user?.id }, 'AI policy updated');
    res.json({ data: policy });
  } catch (err) { next(err); }
});

// =============================================================================
// Providers
// =============================================================================

/**
 * Recommended models per provider kind.  Returned by GET /providers/catalog
 * so the frontend can populate a model selector without hardcoding values.
 */
const PROVIDER_CATALOG = [
  {
    kind: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    requiresEndpoint: false,
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    kind: 'azure_openai',
    label: 'Azure OpenAI',
    requiresApiKey: true,
    requiresEndpoint: true,
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  },
  {
    kind: 'anthropic',
    label: 'Anthropic',
    requiresApiKey: true,
    requiresEndpoint: false,
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  },
  {
    kind: 'gemini',
    label: 'Google Gemini',
    requiresApiKey: true,
    requiresEndpoint: false,
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  },
  {
    kind: 'ollama',
    label: 'Ollama (local)',
    requiresApiKey: false,
    requiresEndpoint: true,
    models: ['llama3.1:8b', 'llama3.1:70b', 'mistral:7b', 'qwen2.5:14b'],
  },
  {
    kind: 'custom',
    label: 'Custom (OpenAI-compatible)',
    requiresApiKey: false,
    requiresEndpoint: true,
    models: [],
  },
];

/**
 * GET /api/v1/ai/providers/catalog
 * Static list of supported provider kinds + recommended models.
 * Must be declared BEFORE /:id to avoid routing conflicts.
 */
router.get('/providers/catalog', requirePermission('ai.providers.read'), (_req, res) => {
  res.json({ data: PROVIDER_CATALOG });
});

/**
 * GET /api/v1/ai/providers
 * List all (non-deleted) providers for the org.
 * api_key_encrypted is NEVER included in the response.
 */
router.get('/providers', requirePermission('ai.providers.read'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum   = Math.max(1, parseInt(page, 10) || 1);
    const limitNum  = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const offset    = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT id, organization_id, name, kind, model, endpoint_url, extra_config,
              temperature, max_tokens, timeout_ms, enabled, priority, created_at, updated_at
       FROM ai_providers
       WHERE organization_id = ? AND deleted_at IS NULL
       ORDER BY priority ASC, id ASC
       LIMIT ? OFFSET ?`,
      [req.orgId, limitNum, offset],
    );
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM ai_providers WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/ai/providers
 * Register a new LLM provider.  If api_key is present it is encrypted with
 * AES-256-GCM before storage; the raw key is never persisted.
 */
router.post('/providers', requirePermission('ai.providers.write'), validate(createAiProvider), async (req, res, next) => {
  try {
    const { api_key, ...rest } = req.body;

    if (!PROVIDER_KINDS.includes(rest.kind)) {
      return next(new ValidationError(`kind must be one of: ${PROVIDER_KINDS.join(', ')}`));
    }

    const record = await AiProvider.create({
      organization_id:   req.orgId,
      name:              rest.name,
      kind:              rest.kind,
      model:             rest.model,
      endpoint_url:      rest.endpoint_url      || null,
      api_key_encrypted: api_key ? encrypt(api_key) : null,
      extra_config:      rest.extra_config       ? JSON.stringify(rest.extra_config) : null,
      temperature:       rest.temperature        ?? 0.20,
      max_tokens:        rest.max_tokens         ?? 800,
      timeout_ms:        rest.timeout_ms         ?? 20000,
      enabled:           rest.enabled            ?? true,
      priority:          rest.priority           ?? 100,
    });

    // Strip encrypted key from response
    const { api_key_encrypted: _k, ...safe } = record;
    logger.info({ orgId: req.orgId, providerId: record.id, kind: record.kind }, 'AI provider registered');
    res.status(201).json({ data: safe });
  } catch (err) { next(err); }
});

/**
 * PUT /api/v1/ai/providers/:id
 * Edit provider settings.  Re-encrypts api_key if supplied.
 */
router.put('/providers/:id', requirePermission('ai.providers.write'), validate(updateAiProvider), async (req, res, next) => {
  try {
    const provider = await AiProvider.findById(req.params.id, req.orgId);
    if (!provider) return next(new NotFoundError('AI provider'));

    const { api_key, ...rest } = req.body;
    const updates = { ...rest };

    if (api_key !== undefined) {
      updates.api_key_encrypted = api_key ? encrypt(api_key) : null;
    }
    if (updates.extra_config !== undefined && typeof updates.extra_config === 'object') {
      updates.extra_config = JSON.stringify(updates.extra_config);
    }

    await AiProvider.update(provider.id, updates);
    const updated = await AiProvider.findById(provider.id, req.orgId);
    const { api_key_encrypted: _k, ...safe } = updated;

    logger.info({ orgId: req.orgId, providerId: provider.id }, 'AI provider updated');
    res.json({ data: safe });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/v1/ai/providers/:id
 * Soft-delete a provider.  Returns 204 No Content.
 */
router.delete('/providers/:id', requirePermission('ai.providers.write'), async (req, res, next) => {
  try {
    const provider = await AiProvider.findById(req.params.id, req.orgId);
    if (!provider) return next(new NotFoundError('AI provider'));

    await AiProvider.delete(provider.id);
    logger.info({ orgId: req.orgId, providerId: provider.id }, 'AI provider soft-deleted');
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/ai/providers/:id/verify
 * Round-trip test: sends a minimal prompt to the provider and returns latency.
 */
router.post('/providers/:id/verify', requirePermission('ai.providers.write'), async (req, res, next) => {
  try {
    const provider = await AiProvider.findById(req.params.id, req.orgId);
    if (!provider) return next(new NotFoundError('AI provider'));

    const result = await llmProviderService.verify(provider.id);
    res.json({ data: result });
  } catch (err) { next(err); }
});

// =============================================================================
// Phrase library
// =============================================================================

/**
 * GET /api/v1/ai/phrases
 * List phrases with optional locale/category filters.
 */
router.get('/phrases', requirePermission('ai.phrases.read'), async (req, res, next) => {
  try {
    const { locale, category, page = 1, limit = 50 } = req.query;
    const result = await phraseLibraryService.listPhrases(req.orgId, {
      locale:   locale   || undefined,
      category: category || undefined,
      page:     parseInt(page,  10) || 1,
      limit:    parseInt(limit, 10) || 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/ai/phrases
 * Create a new phrase.
 */
router.post('/phrases', requirePermission('ai.phrases.write'), validate(createAiPhrase), async (req, res, next) => {
  try {
    const phrase = await phraseLibraryService.createPhrase(req.orgId, req.body);
    res.status(201).json({ data: phrase });
  } catch (err) { next(err); }
});

/**
 * PUT /api/v1/ai/phrases/:id
 * Update an existing phrase.
 */
router.put('/phrases/:id', requirePermission('ai.phrases.write'), validate(updateAiPhrase), async (req, res, next) => {
  try {
    const phrase = await phraseLibraryService.updatePhrase(req.orgId, req.params.id, req.body);
    res.json({ data: phrase });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/v1/ai/phrases/:id
 * Soft-delete a phrase.
 */
router.delete('/phrases/:id', requirePermission('ai.phrases.write'), async (req, res, next) => {
  try {
    await phraseLibraryService.deletePhrase(req.orgId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// =============================================================================
// Forbidden terms
// =============================================================================

/**
 * GET /api/v1/ai/forbidden-terms
 * List forbidden terms with optional locale filter.
 */
router.get('/forbidden-terms', requirePermission('ai.phrases.read'), async (req, res, next) => {
  try {
    const { locale, page = 1, limit = 50 } = req.query;
    const result = await phraseLibraryService.listForbiddenTerms(req.orgId, {
      locale: locale || undefined,
      page:   parseInt(page,  10) || 1,
      limit:  parseInt(limit, 10) || 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/ai/forbidden-terms
 * Add a new forbidden term.
 */
router.post('/forbidden-terms', requirePermission('ai.phrases.write'), validate(createForbiddenTerm), async (req, res, next) => {
  try {
    const term = await phraseLibraryService.createForbiddenTerm(req.orgId, req.body);
    res.status(201).json({ data: term });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/v1/ai/forbidden-terms/:id
 * Delete a forbidden term.
 */
router.delete('/forbidden-terms/:id', requirePermission('ai.phrases.write'), async (req, res, next) => {
  try {
    await phraseLibraryService.deleteForbiddenTerm(req.orgId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// =============================================================================
// Reply
// =============================================================================

/**
 * POST /api/v1/ai/reply/draft
 * Force-generate a draft reply for a ticket (used by the "Generate" button in
 * the staff ticket detail UI).  Overrides the policy mode to 'draft_only' so
 * the result is always returned to the caller rather than auto-sent.
 */
router.post('/reply/draft', requirePermission('ai.reply.draft'), validate(replyDraft), async (req, res, next) => {
  try {
    const { ticket_id, channel = 'portal', inbound_text, contract_id } = req.body;

    const result = await aiReplyService.generate({
      orgId:       req.orgId,
      ticketId:    ticket_id,
      channel,
      inboundText: inbound_text,
      contractId:  contract_id || null,
    });

    res.json({ data: result });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/ai/reply/send
 * Finalize a previously generated draft: update the AiReplyLog with the action
 * ('sent' | 'edited' | 'discarded'), persist the final_text, and — when action
 * is 'sent' or 'edited' — post the text as a new ticket comment.
 */
router.post('/reply/send', requirePermission('ai.reply.send'), validate(replySend), async (req, res, next) => {
  try {
    const { log_id, final_text, action } = req.body;

    // Load the log row (org-scoped)
    const log = await AiReplyLog.findById(log_id, req.orgId);
    if (!log) return next(new NotFoundError('AI reply log'));

    // Persist reviewer decision
    await AiReplyLog.update(log.id, {
      final_text,
      action,
      reviewer_user_id: req.user?.id || null,
    });

    // Post as a ticket comment when the reply is actually being sent/edited
    if (action === 'sent' || action === 'edited') {
      await db.query(
        'INSERT INTO ticket_comments (ticket_id, user_id, body, is_internal) VALUES (?, ?, ?, ?)',
        [log.ticket_id, req.user?.id || null, final_text, false],
      );
    }

    const updated = await AiReplyLog.findById(log.id, req.orgId);
    logger.info({ orgId: req.orgId, logId: log.id, action, userId: req.user?.id }, 'AI reply finalized');
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// =============================================================================
// Logs (audit trail)
// =============================================================================

/**
 * GET /api/v1/ai/logs
 * Paginated list of AiReplyLog rows for the org.
 * Optional query filters: ticket_id, action, date_from, date_to.
 */
router.get('/logs', requirePermission('ai.policy.read'), async (req, res, next) => {
  try {
    const { ticket_id, action, date_from, date_to, page = 1, limit = 50 } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ?'];
    const params     = [req.orgId];

    if (ticket_id) { conditions.push('ticket_id = ?');             params.push(parseInt(ticket_id, 10)); }
    if (action)    { conditions.push('action = ?');                params.push(action); }
    if (date_from) { conditions.push('created_at >= ?');           params.push(date_from); }
    if (date_to)   { conditions.push('created_at <= ?');           params.push(date_to); }

    const where = conditions.join(' AND ');

    const [rows] = await db.query(
      `SELECT id, ticket_id, provider_id, classification, confidence, action,
              reviewer_user_id, prompt_tokens, completion_tokens, cost_usd,
              duration_ms, error, draft_text, context_snapshot, created_at
       FROM ai_reply_logs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset],
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM ai_reply_logs WHERE ${where}`,
      params,
    );

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) { next(err); }
});

// =============================================================================
// Metrics
// =============================================================================

/**
 * GET /api/v1/ai/metrics
 * Returns aggregate AI assistant usage metrics for the current calendar month
 * (or the range specified by date_from / date_to).
 *
 * Response shape:
 *   drafts_total     — total draft attempts
 *   auto_sent        — how many were auto-sent
 *   sent_or_edited   — sent + edited (reviewer accepted)
 *   discarded        — discarded without sending
 *   edit_rate        — sent_or_edited / drafts_total (0 when 0 drafts)
 *   auto_send_rate   — auto_sent / drafts_total
 *   cost_usd_total   — total cost for the period
 *   avg_duration_ms  — average pipeline duration
 */
router.get('/metrics', requirePermission('ai.policy.read'), async (req, res, next) => {
  try {
    const now = new Date();
    const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const { date_from = defaultFrom, date_to } = req.query;

    const conditions = ['organization_id = ?', 'created_at >= ?'];
    const params     = [req.orgId, date_from];

    if (date_to) { conditions.push('created_at <= ?'); params.push(date_to); }

    const where = conditions.join(' AND ');

    const [[agg]] = await db.query(
      `SELECT
         COUNT(*)                                                  AS drafts_total,
         SUM(action = 'auto_sent')                                AS auto_sent,
         SUM(action IN ('sent', 'edited'))                        AS sent_or_edited,
         SUM(action = 'discarded')                                AS discarded,
         COALESCE(SUM(cost_usd),    0)                            AS cost_usd_total,
         COALESCE(AVG(duration_ms), 0)                            AS avg_duration_ms
       FROM ai_reply_logs
       WHERE ${where}`,
      params,
    );

    const drafts    = Number(agg.drafts_total) || 0;
    const autoSent  = Number(agg.auto_sent)    || 0;
    const sentEdited = Number(agg.sent_or_edited) || 0;

    res.json({
      data: {
        drafts_total:    drafts,
        auto_sent:       autoSent,
        sent_or_edited:  sentEdited,
        discarded:       Number(agg.discarded) || 0,
        edit_rate:       drafts > 0 ? Number((sentEdited / drafts).toFixed(4)) : 0,
        auto_send_rate:  drafts > 0 ? Number((autoSent   / drafts).toFixed(4)) : 0,
        cost_usd_total:  Number(Number(agg.cost_usd_total).toFixed(6)),
        avg_duration_ms: Math.round(Number(agg.avg_duration_ms)),
        date_from,
        date_to:         date_to || null,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
