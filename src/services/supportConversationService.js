// =============================================================================
// FireISP 5.0 — Support Conversation Service (§21.2)
// =============================================================================
// Manages AI support conversations: start, message, escalate, close.
//
// Public API:
//   startConversation({ orgId, clientId, channel, message })
//   sendMessage({ conversationId, orgId, content, clientId })
//   escalate({ conversationId, reason, orgId })
//   getConversation(id, orgId)
//   listConversations(orgId, filters)
//   closeConversation(id, orgId)
//   rollupMetrics(orgId, date) — delegated to aiSupportMetricsService
// =============================================================================

const db = require('../config/database');

const intentClassifierService = require('./intentClassifierService');
const supportContextService   = require('./supportContextService');

const logger = require('../utils/logger').child({ service: 'supportConversationService' });

// ---------------------------------------------------------------------------
// Lazy-require helpers (avoid circular dependency chains)
// ---------------------------------------------------------------------------

function getSupportBillingModule()   { return require('./supportBillingModule'); }
function getSupportGeneralModule()   { return require('./supportGeneralModule'); }
function getDiagnosticEngineService(){ return require('./diagnosticEngineService'); }

// ---------------------------------------------------------------------------
// Escalation trigger patterns
// ---------------------------------------------------------------------------

// Explicit human-agent request
const HUMAN_REQUEST_RE = /\b(agent|humano|human|hablar con|speak to|talk to|representative|representante)\b/i;

// Negative sentiment
const NEGATIVE_SENTIMENT_RE = /\b(molesto|enojado|pésimo|horrible|furious|angry|frustrated|terrible|disgusting|pesimo)\b/i;

// Billing dispute / fraud
const BILLING_DISPUTE_RE = /\b(dispute|disputa|refund|reembolso|cobro incorrecto|cargo incorrecto|fraud|fraude)\b/i;

// Confidence threshold below which a message may trigger escalation
const LOW_CONFIDENCE_THRESHOLD = 0.60;

// Number of low-confidence messages that trigger automatic escalation
const MAX_LOW_CONFIDENCE_MESSAGES = 2;

// ---------------------------------------------------------------------------
// getOrgProviderId — LLM routing helper
// ---------------------------------------------------------------------------

/**
 * Return the default AI provider ID for an organisation, or null if none.
 *
 * @param {number} orgId
 * @returns {Promise<number|null>}
 */
async function getOrgProviderId(orgId) {
  try {
    // ai_providers has no `is_default` column — there is no explicit default
    // flag, only a `priority` ordering (lower = higher priority), the same
    // convention kbService.js already uses to pick "the" provider.
    const [rows] = await db.query(
      'SELECT id FROM ai_providers WHERE organization_id = ? AND enabled = 1 AND deleted_at IS NULL ORDER BY priority ASC LIMIT 1',
      [orgId],
    );
    return rows.length > 0 ? rows[0].id : null;
  } catch (err) {
    logger.warn({ err: err.message, orgId }, 'supportConversationService: failed to fetch default provider');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: message persistence helpers
// ---------------------------------------------------------------------------

/**
 * Insert a single message into support_messages.
 *
 * @param {object} opts
 * @param {number} opts.conversationId
 * @param {string} opts.role       — 'customer' | 'assistant' | 'system'
 * @param {string} opts.content
 * @param {string|null} [opts.intent]
 * @param {number|null} [opts.confidence]
 * @param {string|null} [opts.dataSources] — JSON string of diagnostic checks/symptom/confidence (technical-intent replies only)
 * @returns {Promise<number>} — inserted row id
 */
async function _insertMessage({ conversationId, role, content, intent = null, confidence = null, dataSources = null }) {
  const [result] = await db.query(
    `INSERT INTO support_messages (conversation_id, role, content, intent, confidence, data_sources)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conversationId, role, content, intent, confidence, dataSources],
  );
  return result.insertId;
}

// ---------------------------------------------------------------------------
// Internal: AI response generation
// ---------------------------------------------------------------------------

/**
 * Generate an AI assistant reply given the current intent, context, and content.
 *
 * Routes to specialist modules when available; falls back to safe generic
 * responses on any error.  Always prefixes with "Soy tu asistente virtual. ".
 *
 * Return contract (uniform across every branch): `{ text, escalate,
 * escalationReason, dataSources, requiresConfirmation, actionType,
 * actionData }`. `escalate`/`escalationReason` let the caller actually invoke
 * `escalate()` when the diagnostic engine determines a technician is needed —
 * the reply text must never promise an escalation this function doesn't also
 * signal. `requiresConfirmation`/`actionType`/`actionData` are threaded
 * through from supportBillingModule/supportGeneralModule's return shape
 * (`{response, requiresConfirmation, actionType, actionData}`) so a future
 * confirmation-flow consumer isn't starved of them; nothing reads them today.
 *
 * @param {object} opts
 * @param {string} opts.intent            — classified intent
 * @param {object} opts.context           — enriched context from supportContextService
 * @param {string} opts.content           — sanitized customer message
 * @param {Array}  [opts.conversationHistory] — prior messages [{role,content}] (reserved for future LLM multi-turn use)
 * @param {number|null} [opts.orgId]
 * @param {number|null} [opts.clientId]
 * @param {number|null} [opts.conversationId]
 * @returns {Promise<{text: string, escalate: boolean, escalationReason: string|null, dataSources: string|null, requiresConfirmation: boolean, actionType: string|null, actionData: object|null}>}
 */
async function _generateResponse({ intent, context, content, conversationHistory: _conversationHistory = [], orgId = null, clientId = null, conversationId = null }) {
  const PREFIX = 'Soy tu asistente virtual. ';
  const wrap = (text, extra = {}) => ({
    text: PREFIX + text,
    escalate: false,
    escalationReason: null,
    dataSources: null,
    requiresConfirmation: false,
    actionType: null,
    actionData: null,
    ...extra,
  });

  try {
    if (intent === 'billing') {
      const billingModule = getSupportBillingModule();
      if (typeof billingModule.handle === 'function') {
        const reply = await billingModule.handle(intent, context, content);
        // reply is { response, requiresConfirmation, actionType, actionData }
        // — NOT a string. String-concatenating it (`PREFIX + reply`) is what
        // produced the live "[object Object]" bug; use reply.response.
        return wrap(reply.response, {
          requiresConfirmation: Boolean(reply.requiresConfirmation),
          actionType: reply.actionType || null,
          actionData: reply.actionData || null,
        });
      }
    }

    if (intent === 'technical') {
      const diagnosticEngine = getDiagnosticEngineService();
      if (typeof diagnosticEngine.generateSupportResponse === 'function') {
        const outcome = await diagnosticEngine.generateSupportResponse({ orgId, clientId, conversationId, content });
        return wrap(outcome.reply, {
          escalate: outcome.escalate,
          escalationReason: outcome.escalationReason,
          dataSources: outcome.diagnosticResult ? JSON.stringify(outcome.diagnosticResult) : null,
        });
      }
      // Generic technical fallback
      return wrap('Hemos registrado tu problema de conexión. Nuestro equipo técnico revisará tu servicio a la brevedad. ¿Puedes confirmar si el problema comenzó de repente o gradualmente?');
    }

    if (intent === 'general') {
      const generalModule = getSupportGeneralModule();
      if (typeof generalModule.handle === 'function') {
        const reply = await generalModule.handle(intent, context, content);
        // Same object shape (and same historical bug) as the billing branch above.
        return wrap(reply.response, {
          requiresConfirmation: Boolean(reply.requiresConfirmation),
          actionType: reply.actionType || null,
          actionData: reply.actionData || null,
        });
      }
      // Generic general fallback
      return wrap('¿En qué más puedo ayudarte? Si necesitas información sobre horarios, direcciones o contactos, estoy aquí para asistirte.');
    }

  } catch (err) {
    logger.warn({ err: err.message, intent, orgId }, 'supportConversationService: module response failed — using generic fallback');
  }

  // Default / 'other' intent
  return wrap('Permíteme conectarte con el área correcta. Un momento, por favor.');
}

// ---------------------------------------------------------------------------
// Internal: load conversation + messages
// ---------------------------------------------------------------------------

/**
 * Load a conversation row and all its messages from the database.
 *
 * @param {number} id    — conversation id
 * @param {number} orgId — organisation id (scoping)
 * @returns {Promise<{ conversation: object, messages: object[] } | null>}
 */
async function _loadConversation(id, orgId) {
  const [convRows] = await db.query(
    'SELECT * FROM support_conversations WHERE id = ? AND organization_id = ?',
    [id, orgId],
  );
  if (convRows.length === 0) return null;

  const [msgRows] = await db.query(
    'SELECT * FROM support_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [id],
  );

  return { conversation: convRows[0], messages: msgRows };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new AI support conversation.
 *
 * Inserts: conversation row, system greeting, customer opening message,
 * and first assistant reply.
 *
 * @param {object} opts
 * @param {number} opts.orgId
 * @param {number} opts.clientId
 * @param {string} [opts.channel] — 'web' | 'whatsapp' | 'sms' | 'email' (default 'web')
 * @param {string} opts.message   — customer's opening message
 * @returns {Promise<{ conversation: object, messages: object[] }>}
 */
async function startConversation({ orgId, clientId, channel = 'web', message }) {
  if (!orgId || !clientId) {
    throw new Error('supportConversationService.startConversation: orgId and clientId are required');
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('supportConversationService.startConversation: message is required');
  }

  // Keyword-only classification for the opening message (deterministic; no LLM cost)
  const { intent, confidence } = await intentClassifierService.classify(message, null);

  // Insert conversation row
  const [convResult] = await db.query(
    `INSERT INTO support_conversations (organization_id, client_id, channel, status, intent, confidence)
     VALUES (?, ?, ?, 'open', ?, ?)`,
    [orgId, clientId, channel, intent, confidence],
  );
  const conversationId = convResult.insertId;

  logger.info({ conversationId, orgId, clientId, intent }, 'supportConversationService: conversation started');

  // System greeting
  await _insertMessage({
    conversationId,
    role:    'system',
    content: 'Soy tu asistente virtual de FireISP. ¿En qué puedo ayudarte hoy?',
  });

  // Customer opening message
  await _insertMessage({
    conversationId,
    role:       'customer',
    content:    message,
    intent,
    confidence,
  });

  // Gather context for the AI response
  let context = null;
  try {
    context = await supportContextService.enrichContext({ orgId, clientId });
  } catch (err) {
    logger.warn({ err: err.message, conversationId }, 'supportConversationService: context enrichment failed');
  }

  // Generate AI response
  const aiResponse = await _generateResponse({
    intent,
    context,
    content: intentClassifierService.sanitize(message),
    orgId,
    clientId,
    conversationId,
  });

  // Insert assistant message
  await _insertMessage({
    conversationId,
    role:        'assistant',
    content:     aiResponse.text,
    intent,
    confidence,
    dataSources: aiResponse.dataSources,
  });

  // Actually escalate when the diagnostic engine says a technician is
  // required — a reply that talks about connecting the customer to a
  // technician must not be a no-op (see PR F brief: no fake "technician
  // scheduled").
  if (aiResponse.escalate) {
    await escalate({ conversationId, reason: aiResponse.escalationReason || 'diagnostic_escalation', orgId });
  }

  return _loadConversation(conversationId, orgId);
}

/**
 * Send a follow-up message in an existing conversation.
 *
 * Handles escalation detection and routes to the AI response generator when
 * no escalation is triggered.
 *
 * @param {object} opts
 * @param {number} opts.conversationId
 * @param {number} opts.orgId
 * @param {string} opts.content
 * @param {number} [opts.clientId]
 * @returns {Promise<{ conversation: object, messages: object[] }>}
 */
async function sendMessage({ conversationId, orgId, content, clientId }) {
  // Verify conversation ownership
  const [convRows] = await db.query(
    'SELECT * FROM support_conversations WHERE id = ? AND organization_id = ?',
    [conversationId, orgId],
  );
  if (convRows.length === 0) {
    throw new Error(`supportConversationService.sendMessage: conversation ${conversationId} not found`);
  }
  const conv = convRows[0];

  // Sanitize and classify
  const sanitized = intentClassifierService.sanitize(content);
  const { intent, confidence } = await intentClassifierService.classify(sanitized, null);

  // Insert customer message
  await _insertMessage({
    conversationId,
    role:       'customer',
    content:    sanitized,
    intent,
    confidence,
  });

  // ── Escalation detection ─────────────────────────────────────────────────

  let escalationReason = null;

  // 1. Explicit human-agent request
  if (!escalationReason && HUMAN_REQUEST_RE.test(sanitized)) {
    escalationReason = 'human_requested';
  }

  // 2. Negative sentiment
  if (!escalationReason && NEGATIVE_SENTIMENT_RE.test(sanitized)) {
    escalationReason = 'negative_sentiment';
  }

  // 3. Billing dispute / fraud keyword
  if (!escalationReason && BILLING_DISPUTE_RE.test(sanitized)) {
    escalationReason = 'billing_dispute';
  }

  // 4. Low confidence on current message
  if (!escalationReason && confidence < LOW_CONFIDENCE_THRESHOLD) {
    // Count prior low-confidence customer messages in this conversation
    try {
      const [lowRows] = await db.query(
        `SELECT COUNT(*) AS cnt
         FROM support_messages
         WHERE conversation_id = ?
           AND role = 'customer'
           AND confidence < ?`,
        [conversationId, LOW_CONFIDENCE_THRESHOLD],
      );
      const failedAttempts = Number(lowRows[0].cnt);
      if (failedAttempts >= MAX_LOW_CONFIDENCE_MESSAGES) {
        escalationReason = 'low_confidence_repeated';
      }
    } catch (err) {
      logger.warn({ err: err.message, conversationId }, 'supportConversationService: failed to count low-confidence messages');
    }
  }

  // 5. Conversation already escalated — don't generate AI reply
  if (!escalationReason && conv.status === 'escalated') {
    escalationReason = 'already_escalated';
  }

  if (escalationReason) {
    logger.info({ conversationId, orgId, escalationReason }, 'supportConversationService: escalation triggered');
    await escalate({ conversationId, reason: escalationReason, orgId });
    return _loadConversation(conversationId, orgId);
  }

  // ── Generate and persist AI response ─────────────────────────────────────

  let context = null;
  if (clientId) {
    try {
      context = await supportContextService.enrichContext({ orgId, clientId });
    } catch (err) {
      logger.warn({ err: err.message, conversationId }, 'supportConversationService: context enrichment failed in sendMessage');
    }
  }

  // Gather recent conversation history for the AI
  const [historyRows] = await db.query(
    `SELECT role, content FROM support_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT 20`,
    [conversationId],
  ).catch(() => [[]]);

  const aiResponse = await _generateResponse({
    intent,
    context,
    content: sanitized,
    conversationHistory: historyRows,
    orgId,
    clientId,
    conversationId,
  });

  await _insertMessage({
    conversationId,
    role:        'assistant',
    content:     aiResponse.text,
    intent,
    confidence,
    dataSources: aiResponse.dataSources,
  });

  // See startConversation's identical comment: escalate:true must actually
  // create the escalation, not just be worded as if it will.
  if (aiResponse.escalate) {
    await escalate({ conversationId, reason: aiResponse.escalationReason || 'diagnostic_escalation', orgId });
  }

  return _loadConversation(conversationId, orgId);
}

/**
 * Create the escalation ticket for a conversation and link it back via
 * `ticket_id`. Used both on first escalation and to REPAIR a conversation
 * whose earlier ticket-creation attempt failed (`ticket_id` still NULL —
 * see `escalate()`'s affectedRows===0 branch). Ticket-creation failure must
 * not abort the caller: it's swallowed and logged, leaving `ticket_id` NULL
 * so a later `escalate()` call retries it again.
 *
 * @param {object} opts
 * @param {number} opts.conversationId
 * @param {number} opts.orgId
 * @param {string} [opts.reason]
 */
async function _createEscalationTicket({ conversationId, orgId, reason }) {
  try {
    const [ticketResult] = await db.query(
      `INSERT INTO tickets (organization_id, client_id, subject, description, status, priority, source)
       SELECT
         sc.organization_id,
         sc.client_id,
         CONCAT('AI Support Escalation: ', COALESCE(sc.intent, 'general')),
         ?,
         'open',
         'medium',
         'ai_escalated'
       FROM support_conversations sc
       WHERE sc.id = ? AND sc.organization_id = ?`,
      [
        `Escalated from AI support conversation #${conversationId}. Reason: ${reason || 'manual'}`,
        conversationId,
        orgId,
      ],
    );

    if (ticketResult.insertId) {
      await db.query(
        'UPDATE support_conversations SET ticket_id = ? WHERE id = ? AND organization_id = ?',
        [ticketResult.insertId, conversationId, orgId],
      );
      logger.info({ conversationId, orgId, ticketId: ticketResult.insertId }, 'supportConversationService: escalation ticket created');
    }
  } catch (err) {
    // Ticket creation failure must not abort the escalation itself
    logger.error({ err: err.message, conversationId, orgId }, 'supportConversationService: failed to create escalation ticket');
  }
}

/**
 * Escalate a conversation to a human agent.
 *
 * Idempotent AND concurrency-safe via an atomic conditional claim: the
 * status flip itself (`UPDATE ... WHERE status <> 'escalated'`) is the
 * lock, so only one caller — even under two simultaneous escalate() calls
 * for the same conversation — ever creates the ticket + handoff message.
 * A conversation that's already escalated with a ticket is a true no-op; a
 * conversation that's already escalated but is missing its ticket (a prior
 * attempt's ticket INSERT failed, see `_createEscalationTicket`) gets that
 * ticket repaired without re-touching status or re-sending the handoff
 * message.
 *
 * @param {object} opts
 * @param {number} opts.conversationId
 * @param {string} opts.reason
 * @param {number} opts.orgId
 * @returns {Promise<{ conversation: object, messages: object[] }>}
 */
async function escalate({ conversationId, reason, orgId }) {
  // Atomic claim: this UPDATE only matches (affectedRows === 1) a
  // conversation that is NOT already 'escalated'. That condition is what
  // makes this safe under concurrency (two simultaneous calls: at most one
  // UPDATE can match, since the loser's WHERE no longer holds once the
  // winner commits) AND idempotent (a later call on an already-escalated
  // conversation always affects 0 rows) — a plain SELECT-then-UPDATE guard
  // is neither: it has a race window between the read and the write, and a
  // status-only check can't distinguish "already escalated with a ticket"
  // from "already escalated but the ticket never got created."
  const [claimResult] = await db.query(
    `UPDATE support_conversations
     SET status = 'escalated', escalation_reason = ?, escalated_at = NOW()
     WHERE id = ? AND organization_id = ? AND status <> 'escalated'`,
    [reason || 'manual', conversationId, orgId],
  );

  if (claimResult.affectedRows === 1) {
    // We won the claim — this is the first escalation for this
    // conversation. Create the ticket and the handoff message exactly once.
    await _createEscalationTicket({ conversationId, orgId, reason });
    await _insertMessage({
      conversationId,
      role:    'system',
      content: 'Tu conversación ha sido escalada a un agente humano. Por favor espera.',
    });
    return _loadConversation(conversationId, orgId);
  }

  // affectedRows === 0: the conversation was already 'escalated' (by an
  // earlier call, or by a concurrent winner that committed first). Never
  // re-touch status/escalated_at/escalation_reason and never re-send the
  // handoff message — but DO repair a missing ticket, so the dedicated
  // manual retry endpoint (POST /conversations/:id/escalate) can still fix
  // a conversation whose first ticket-creation attempt failed, rather than
  // being permanently stuck with status='escalated' and no ticket.
  const [rows] = await db.query(
    'SELECT ticket_id FROM support_conversations WHERE id = ? AND organization_id = ?',
    [conversationId, orgId],
  );
  const ticketId = rows[0]?.ticket_id;

  if (!ticketId) {
    logger.info(
      { conversationId, orgId },
      'supportConversationService: escalate() repairing missing ticket for an already-escalated conversation',
    );
    await _createEscalationTicket({ conversationId, orgId, reason });
  } else {
    logger.info(
      { conversationId, orgId, ticketId },
      'supportConversationService: escalate() no-op — conversation already escalated with a ticket',
    );
  }

  return _loadConversation(conversationId, orgId);
}

/**
 * Retrieve a single conversation with all its messages.
 *
 * @param {number} id
 * @param {number} orgId
 * @returns {Promise<{ conversation: object, messages: object[] } | null>}
 */
async function getConversation(id, orgId) {
  return _loadConversation(id, orgId);
}

/**
 * List conversations for an organisation with optional filtering.
 *
 * @param {number} orgId
 * @param {object} [filters]
 * @param {string}  [filters.status]   — 'open' | 'escalated' | 'closed'
 * @param {string}  [filters.channel]
 * @param {number}  [filters.clientId]
 * @param {number}  [filters.limit]    — default 50
 * @param {number}  [filters.offset]   — default 0
 * @returns {Promise<{ conversations: object[], total: number }>}
 */
async function listConversations(orgId, filters = {}) {
  const { status, channel, clientId, limit = 50, offset = 0 } = filters;

  const conditions = ['organization_id = ?'];
  const params     = [orgId];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (channel) {
    conditions.push('channel = ?');
    params.push(channel);
  }
  if (clientId) {
    conditions.push('client_id = ?');
    params.push(clientId);
  }

  const where = conditions.join(' AND ');

  const safeLimit  = Math.max(1, parseInt(limit, 10) || 50);
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM support_conversations WHERE ${where}`,
    params,
  );
  const total = Number(countRows[0].total);

  const [rows] = await db.query(
    `SELECT * FROM support_conversations WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );

  return { conversations: rows, total };
}

/**
 * Close a conversation.
 *
 * @param {number} id
 * @param {number} orgId
 * @returns {Promise<boolean>} — true if a row was updated
 */
async function closeConversation(id, orgId) {
  const [result] = await db.query(
    `UPDATE support_conversations SET status = 'closed'
     WHERE id = ? AND organization_id = ? AND status != 'closed'`,
    [id, orgId],
  );
  const updated = result.affectedRows > 0;
  if (updated) {
    logger.info({ id, orgId }, 'supportConversationService: conversation closed');
  }
  return updated;
}

/**
 * Roll up AI support metrics for the given date.
 * Delegates to aiSupportMetricsService to keep this file focused.
 *
 * @param {number} orgId
 * @param {string|Date} date — ISO date string or Date object
 * @returns {Promise<object>}
 */
async function rollupMetrics(orgId, date) {
  try {
    const aiSupportMetricsService = require('./aiSupportMetricsService');
    return await aiSupportMetricsService.rollup(orgId, date);
  } catch (err) {
    logger.error({ err: err.message, orgId }, 'supportConversationService: metrics rollup failed');
    throw err;
  }
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  startConversation,
  sendMessage,
  escalate,
  getConversation,
  listConversations,
  closeConversation,
  rollupMetrics,
  getOrgProviderId,
  // Exposed for unit testing
  _generateResponse,
};
