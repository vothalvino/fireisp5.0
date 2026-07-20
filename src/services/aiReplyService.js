// =============================================================================
// FireISP 5.0 — AI Reply Service (P1 §3.5) — Orchestrator
// =============================================================================
// 10-step pipeline that produces, validates, and dispatches AI-generated
// customer-support replies for tickets.
//
// Public API:
//   generate({ orgId, ticketId, channel, inboundText, contractId })
//     → { skipped: true, reason }                  — gate short-circuit
//       | { skipped: false, logId, draftText, action }  — pipeline result
//
// Pipeline steps:
//   1.  Gate          — AiPolicy enabled + channel allowed + active provider set
//   2.  Classify      — small LLM call → {category, priority, language, confidence}
//   3.  Context       — topologyContextService.summarize + serviceHealthService.getSnapshot
//   4.  Redact PII    — regex-based (IP, MAC, email, phone) when policy.redact_pii_before_llm
//   5.  Render prompt — tone, phrases by category, forbidden terms, context, history
//   6.  Generate      — llmProviderService.chat
//   7.  Validate      — required-phrase + forbidden-term + length + URL check; up to 2 retries
//   8.  Rehydrate PII — restore original values in final text
//   9.  Persist log   — AiReplyLog row (context already redacted)
//  10.  Dispatch      — draft_only | suggest | auto_send
//
// Security: PII is never stored in logs — the context_snapshot is written only
// AFTER redaction has been applied.
// =============================================================================

const crypto = require('crypto');

const AiPolicy    = require('../models/AiPolicy');
const AiReplyLog  = require('../models/AiReplyLog');
const Ticket      = require('../models/Ticket');
const TicketComment = require('../models/TicketComment');
const Notification  = require('../models/Notification');

const topologyContextService = require('./topologyContextService');
const serviceHealthService   = require('./serviceHealthService');
const phraseLibraryService   = require('./phraseLibraryService');
const llmProviderService     = require('./llmProviderService');
const kbService              = require('./kbService');

const logger = require('../utils/logger').child({ service: 'aiReplyService' });

// ---------------------------------------------------------------------------
// Maximum generation attempts (initial + 2 retries on validation failure)
// ---------------------------------------------------------------------------
const MAX_GENERATE_ATTEMPTS = 3;

// Maximum number of recent ticket comments to include in the prompt
const HISTORY_WINDOW = 10;

// ---------------------------------------------------------------------------
// PII Redaction
// ---------------------------------------------------------------------------

/**
 * Ordered list of PII patterns to redact before sending text to the LLM.
 * More specific patterns (email, MAC) are listed before more general ones
 * (phone, IPv4) to avoid partial matches.
 */
const PII_PATTERNS = [
  // Email — must come before phone to avoid eating the domain part
  { name: 'EMAIL', re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g },
  // MAC address
  { name: 'MAC', re: /\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b/g },
  // IPv4 address (loose — catches private + public ranges)
  { name: 'IP', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Phone: +52 (55) 1234-5678, 55-1234-5678, +1 800 555 1234, etc.
  { name: 'PHONE', re: /\b\+?[\d][\d\s().-]{6,14}[\d]\b/g },
];

/**
 * Replace PII tokens in `text` with placeholder tokens.
 * Returns { redacted: string, mapping: Map<token, original> }.
 *
 * Tokens are deterministic per run (counter resets per call), so the
 * mapping is valid for the lifetime of the generate() invocation only.
 *
 * @param {string} text
 * @returns {{ redacted: string, mapping: Map<string,string> }}
 */
function _redactPii(text) {
  const mapping = new Map();
  let counter   = 0;
  let result    = text;

  for (const { name, re } of PII_PATTERNS) {
    // Reset lastIndex to 0 before each scan (global regex is stateful)
    re.lastIndex = 0;
    result = result.replace(re, (match) => {
      counter += 1;
      const token = `[${name}_${counter}]`;
      mapping.set(token, match);
      return token;
    });
  }

  return { redacted: result, mapping };
}

/**
 * Restore original PII values by replacing placeholder tokens.
 *
 * @param {string} text
 * @param {Map<string,string>} mapping
 * @returns {string}
 */
function _rehydratePii(text, mapping) {
  let result = text;
  for (const [token, original] of mapping) {
    // Replace all occurrences; split+join avoids regex escaping issues
    result = result.split(token).join(original);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 2 — Classification
// ---------------------------------------------------------------------------

/**
 * Classify an inbound message using a small LLM call.
 * Falls back to neutral defaults on any error so the pipeline is not blocked.
 *
 * @param {number} providerId
 * @param {string} text
 * @param {string} locale
 * @returns {Promise<{category:string, priority:string, language:string, confidence:number}>}
 */
async function _classifyMessage(providerId, text, locale) {
  const messages = [
    {
      role: 'system',
      content: `You are a classifier for ISP customer support messages.
Analyze the message and respond with a JSON object with exactly these fields:
- category: one of ["connectivity","billing","technical","general","complaint","outage"]
- priority: one of ["low","medium","high","urgent"]
- language: BCP-47 tag e.g. "es-MX", "en", "pt-BR"
- confidence: float 0.0 to 1.0
Respond with only valid JSON — no markdown fences, no extra text.`,
    },
    { role: 'user', content: text },
  ];

  try {
    const result  = await llmProviderService.chat({ providerId, messages, jsonSchema: { type: 'object' } });
    const parsed  = result.json || {};
    return {
      category:   typeof parsed.category === 'string'   ? parsed.category   : 'general',
      priority:   typeof parsed.priority === 'string'   ? parsed.priority   : 'medium',
      language:   typeof parsed.language === 'string'   ? parsed.language   : locale,
      confidence: Number.isFinite(parseFloat(parsed.confidence)) ? parseFloat(parsed.confidence) : 0.5,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'aiReplyService: classification failed — using safe defaults');
    return { category: 'general', priority: 'medium', language: locale, confidence: 0.5 };
  }
}

// ---------------------------------------------------------------------------
// Step 5 — System prompt rendering
// ---------------------------------------------------------------------------

/**
 * Build the system prompt string for the reply generation LLM call.
 *
 * @param {object} opts
 * @param {string}   opts.tone              — formal | neutral | friendly
 * @param {string}   opts.category          — classification category
 * @param {object}   opts.phrasesByCategory — {[category]: phrase[]}
 * @param {object[]} opts.forbiddenTerms    — [{term, replacement}]
 * @param {string}   opts.contextJson       — already-redacted context JSON string
 * @param {object[]} opts.ticketHistory     — last N ticket comment rows
 * @param {string[]} [opts.ragChunks]       — semantically retrieved phrase texts
 * @returns {string}
 */
function _renderSystemPrompt({ tone, category, phrasesByCategory, forbiddenTerms, contextJson, ticketHistory, ragChunks = [] }) {
  const phrases      = phrasesByCategory[category] || phrasesByCategory['general'] || [];
  const required     = phrases.filter(p => Number(p.is_required) === 1).map(p => `- "${p.text}"`);
  const suggested    = phrases.filter(p => Number(p.is_required) !== 1).map(p => `- "${p.text}"`);
  const forbidden    = forbiddenTerms.map(t => `- "${t.term}"`);

  // created_at is a TIMESTAMP column → JS Date; interpolated raw it prints the
  // verbose "Wed Aug 12 2026 00:00:00 GMT+0000 (…)" form into the LLM prompt —
  // noise the model could echo back to the customer. Compact ISO instead.
  const historyLines = ticketHistory.length
    ? ticketHistory.map(c =>
      `[${new Date(c.created_at).toISOString().slice(0, 16).replace('T', ' ')}]${c.is_internal ? ' (internal)' : ''} ${c.body}`,
    ).join('\n---\n')
    : '(no prior messages)';

  return [
    `You are a customer support agent for an ISP. Use a ${tone} tone.`,
    '',
    '## Required phrases — MUST appear verbatim in your reply',
    required.length ? required.join('\n') : '(none)',
    '',
    '## Suggested phrases — use where relevant',
    suggested.length ? suggested.join('\n') : '(none)',
    '',
    '## Forbidden terms — NEVER include these',
    forbidden.length ? forbidden.join('\n') : '(none)',
    '',
    '## Network & service context',
    contextJson,
    '',
    '## Ticket history (oldest → newest)',
    historyLines,
    '',
    '## Relevant retrieved phrases (semantic search)',
    ragChunks.length ? ragChunks.map(c => `- "${c}"`).join('\n') : '(none)',
    '',
    'Reply ONLY with the customer-facing response text. No preamble, no metadata.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Step 7 — Output validation
// ---------------------------------------------------------------------------

/**
 * Validate LLM output against library rules and safety heuristics.
 *
 * Checks performed:
 *  • Required phrases present / forbidden terms absent (via phraseValidation)
 *  • Non-empty and not excessively long (> 2 000 chars)
 *  • Any http(s) URLs present are in the allowlist (if allowedUrlDomains is set)
 *  • No obvious device-name hallucinations (warn-level only)
 *
 * @param {string} text
 * @param {object} opts
 * @param {object}   opts.phraseValidation     — result of phraseLibraryService.validateDraft
 * @param {object}   [opts.contextSnapshot]    — topology snapshot (for hallucination check)
 * @param {string[]} [opts.allowedUrlDomains]  — hostname allowlist; empty = no URLs allowed
 * @returns {{ valid: boolean, errors: string[] }}
 */
function _validateOutput(text, { phraseValidation, contextSnapshot = null, allowedUrlDomains = [] }) {
  const errors = [];

  // Phrase library checks
  if (!phraseValidation.valid) {
    for (const phrase of phraseValidation.missingRequired) {
      errors.push(`Missing required phrase: "${phrase}"`);
    }
    for (const { term } of phraseValidation.hitForbidden) {
      errors.push(`Contains forbidden term: "${term}"`);
    }
  }

  // Length checks
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) {
    errors.push('LLM returned an empty response');
  } else if (trimmed.length > 2000) {
    errors.push(`Response too long: ${trimmed.length} chars (max 2000)`);
  }

  // URL allowlist
  const urlMatches = trimmed.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  for (const url of urlMatches) {
    try {
      const { hostname } = new URL(url);
      if (allowedUrlDomains.length > 0 && !allowedUrlDomains.includes(hostname)) {
        errors.push(`URL not in allowlist: ${url}`);
      } else if (allowedUrlDomains.length === 0) {
        errors.push(`External URL not allowed: ${url}`);
      }
    } catch {
      errors.push(`Malformed URL in response: ${url}`);
    }
  }

  // Device-name hallucination — warn only; does not fail validation
  if (contextSnapshot) {
    const knownNames = new Set([
      contextSnapshot.accessDevice?.name,
      contextSnapshot.coreDevice?.name,
      ...(contextSnapshot.backhauls || []).map(b => b?.name),
    ].filter(Boolean).map(n => n.toLowerCase()));

    const deviceMentions = trimmed.match(/\b(?:router|switch|olt|onu|cpe|ap|access point)\s+\S+/gi) || [];
    for (const mention of deviceMentions) {
      const last = mention.split(/\s+/).pop().toLowerCase();
      if (last.length > 3 && !knownNames.has(last) && knownNames.size > 0) {
        logger.warn({ mention }, 'aiReplyService: possible hallucinated device name in reply');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Triage persistence
// ---------------------------------------------------------------------------

// Classifier emits 'urgent'; the ticket_ai_triage enum tops out at 'critical'.
const TRIAGE_PRIORITY_MAP = { low: 'low', medium: 'medium', high: 'high', urgent: 'critical' };

/**
 * Upsert the per-ticket AI triage suggestion (one row per ticket via
 * uq_ticket_ai_triage_ticket). Best-effort: a triage failure must never fail
 * the reply pipeline, so errors are logged and swallowed.
 */
async function _persistTriage({ ticketId, orgId, classification, suggestedResolution, contextSnapshot, inboundText, locale }) {
  const db = require('../config/database');
  try {
    let kbArticleIds = [];
    try {
      const articles = await kbService.searchArticles(orgId, inboundText, locale || null, 5);
      kbArticleIds = (articles || []).map((a) => a.id).filter(Boolean);
    } catch (err) {
      logger.warn({ orgId, ticketId, err: err.message }, 'aiReplyService: KB search for triage failed');
    }

    await db.query(
      `INSERT INTO ticket_ai_triage
         (ticket_id, suggested_category, suggested_priority, suggested_resolution,
          kb_article_ids, context_snapshot, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         suggested_category   = VALUES(suggested_category),
         suggested_priority   = VALUES(suggested_priority),
         suggested_resolution = VALUES(suggested_resolution),
         kb_article_ids       = VALUES(kb_article_ids),
         context_snapshot     = VALUES(context_snapshot),
         processed_at         = NOW()`,
      [
        ticketId,
        classification.category || null,
        TRIAGE_PRIORITY_MAP[classification.priority] || null,
        suggestedResolution,
        JSON.stringify(kbArticleIds),
        contextSnapshot,
      ],
    );
  } catch (err) {
    logger.warn({ orgId, ticketId, err: err.message }, 'aiReplyService: failed to persist ticket_ai_triage row');
  }
}

// ---------------------------------------------------------------------------
// Public API — generate
// ---------------------------------------------------------------------------

/**
 * Run the full AI Reply pipeline for a ticket message.
 *
 * @param {object}  opts
 * @param {number}  opts.orgId        — organization ID
 * @param {number}  opts.ticketId     — ticket ID
 * @param {string}  [opts.channel]    — 'portal' | 'email' | 'whatsapp' | 'sms' (default: 'portal')
 * @param {string}  opts.inboundText  — client's message text
 * @param {number}  [opts.contractId] — contract ID for topology/health context (optional)
 * @returns {Promise<{skipped:true, reason:string} | {skipped:false, logId:number, draftText:string|null, action:string}>}
 */
async function generate({ orgId, ticketId, channel = 'portal', inboundText, contractId = null } = {}) {
  const startTime = Date.now();

  // ── Step 1: Gate ────────────────────────────────────────────────────────────
  const policy = await AiPolicy.findByOrgId(orgId);

  if (!Number(policy.enabled)) {
    logger.info({ orgId, ticketId }, 'aiReplyService: skipped — policy disabled');
    return { skipped: true, reason: 'policy_disabled' };
  }

  const enabledChannels = typeof policy.enabled_channels === 'string'
    ? JSON.parse(policy.enabled_channels)
    : (policy.enabled_channels || {});

  if (!enabledChannels[channel]) {
    logger.info({ orgId, ticketId, channel }, 'aiReplyService: skipped — channel disabled');
    return { skipped: true, reason: 'channel_disabled' };
  }

  if (!policy.active_provider_id) {
    logger.info({ orgId, ticketId }, 'aiReplyService: skipped — no active provider configured');
    return { skipped: true, reason: 'no_active_provider' };
  }

  const providerId = policy.active_provider_id;
  const locale     = policy.default_locale || 'es-MX';
  const tone       = policy.tone            || 'formal';
  const mode       = policy.mode            || 'draft_only';

  // ── Step 2: Classify ────────────────────────────────────────────────────────
  const classification = await _classifyMessage(providerId, inboundText, locale);

  // ── Step 3: Build context ───────────────────────────────────────────────────
  const [topologyCtx, healthSnapshot] = await Promise.all([
    contractId ? topologyContextService.summarize(contractId) : Promise.resolve(null),
    contractId ? serviceHealthService.getSnapshot(contractId) : Promise.resolve(null),
  ]);

  const rawContextObj = { topology: topologyCtx, health: healthSnapshot };

  // ── Step 4: Redact PII ──────────────────────────────────────────────────────
  let workingInbound    = inboundText;
  let workingContextStr = JSON.stringify(rawContextObj);
  const piiMapping      = new Map();

  if (Number(policy.redact_pii_before_llm) === 1) {
    const r1 = _redactPii(workingInbound);
    const r2 = _redactPii(workingContextStr);
    workingInbound    = r1.redacted;
    workingContextStr = r2.redacted;
    for (const [k, v] of r1.mapping) piiMapping.set(k, v);
    for (const [k, v] of r2.mapping) piiMapping.set(k, v);
  }

  // ── Step 5: Render system prompt ────────────────────────────────────────────
  const [phrasesByCategory, forbiddenTerms, ticketHistory, ragChunks] = await Promise.all([
    phraseLibraryService.getPhrasesByCategory(orgId, locale),
    phraseLibraryService.getTermsByLocale(orgId, locale),
    Ticket.getComments(ticketId),
    phraseLibraryService.search(orgId, locale, workingInbound, 5),
  ]);

  const systemPrompt = _renderSystemPrompt({
    tone,
    category:          classification.category,
    phrasesByCategory,
    forbiddenTerms,
    contextJson:       workingContextStr,
    ticketHistory:     ticketHistory.slice(-HISTORY_WINDOW),
    ragChunks,
  });

  const promptHash = crypto.createHash('sha256').update(systemPrompt).digest('hex');

  const baseMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: workingInbound },
  ];

  // ── Steps 6 + 7: Generate + Validate (up to MAX_GENERATE_ATTEMPTS) ──────────
  let draftText    = null;
  let llmUsage     = null;
  let totalCostUsd = 0;
  let lastErrors   = [];
  let succeeded    = false;
  let retryMessages = baseMessages;

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    let llmResult;
    try {
      llmResult = await llmProviderService.chat({ providerId, messages: retryMessages });
    } catch (err) {
      lastErrors = [err.message];
      logger.warn({ attempt: attempt + 1, err: err.message }, 'aiReplyService: LLM call failed');
      break; // Do not retry on transport-level failure
    }

    llmUsage       = llmResult.usage;
    totalCostUsd  += llmResult.cost_usd || 0;
    draftText      = llmResult.text;

    const phraseValidation = await phraseLibraryService.validateDraft(orgId, locale, draftText);
    const outputValidation = _validateOutput(draftText, {
      phraseValidation,
      contextSnapshot: topologyCtx,
    });

    if (outputValidation.valid) {
      succeeded = true;
      break;
    }

    lastErrors = outputValidation.errors;
    logger.warn({ attempt: attempt + 1, errors: lastErrors }, 'aiReplyService: output validation failed — retrying');

    if (attempt < MAX_GENERATE_ATTEMPTS - 1) {
      retryMessages = [
        ...baseMessages,
        { role: 'assistant', content: draftText },
        {
          role: 'user',
          content: `Your previous reply had these issues — please fix them and try again:\n${lastErrors.map(e => `• ${e}`).join('\n')}`,
        },
      ];
    }
  }

  // ── Step 8: Rehydrate PII ───────────────────────────────────────────────────
  const finalText = draftText ? _rehydratePii(draftText, piiMapping) : null;

  // ── Step 9: Persist AiReplyLog ─────────────────────────────────────────────
  // Store the redacted context snapshot so PII is never written to the log.
  const logAction  = succeeded ? 'proposed' : 'failed';
  const logEntry   = await AiReplyLog.create({
    organization_id:   orgId,
    ticket_id:         ticketId,
    provider_id:       providerId,
    classification:    classification.category,
    confidence:        classification.confidence,
    context_snapshot:  workingContextStr,   // already redacted
    prompt_hash:       promptHash,
    draft_text:        draftText,
    final_text:        finalText,
    action:            logAction,
    prompt_tokens:     llmUsage?.prompt_tokens  || null,
    completion_tokens: llmUsage?.completion_tokens || null,
    cost_usd:          totalCostUsd,
    duration_ms:       Date.now() - startTime,
    error:             succeeded ? null : lastErrors.join('; '),
  });

  // ── Step 9b: Persist triage suggestion ──────────────────────────────────────
  // One row per ticket (uq_ticket_ai_triage_ticket) — re-triage on each new
  // inbound message. Feeds GET /tickets/:id/ai-triage and the AiTriagePanel.
  await _persistTriage({
    ticketId,
    orgId,
    classification,
    suggestedResolution: succeeded ? finalText : null,
    contextSnapshot: workingContextStr, // already redacted
    inboundText: workingInbound,
    locale,
  });

  if (!succeeded) {
    logger.error({ orgId, ticketId, errors: lastErrors }, 'aiReplyService: all generation attempts failed');
    return { skipped: false, logId: logEntry.id, draftText: null, action: 'failed' };
  }

  // ── Step 10: Dispatch ───────────────────────────────────────────────────────
  const ticket = await Ticket.findById(ticketId, orgId);

  if (mode === 'draft_only') {
    await Ticket.addComment({
      ticket_id:   ticketId,
      user_id:     null,
      body:        `[AI Suggested Reply]\n${finalText}`,
      is_internal: true,
    });
    logger.info({ orgId, ticketId, logId: logEntry.id }, 'aiReplyService: draft attached (draft_only)');
    return { skipped: false, logId: logEntry.id, draftText: finalText, action: 'proposed' };
  }

  if (mode === 'suggest') {
    await Ticket.addComment({
      ticket_id:   ticketId,
      user_id:     null,
      body:        `[AI Suggested Reply]\n${finalText}`,
      is_internal: true,
    });
    if (ticket?.assigned_to) {
      // Never let a notification hiccup fail the reply pipeline.
      await Notification.create({
        user_id:     ticket.assigned_to,
        type:        'ticket',
        title:       'AI Reply Suggested',
        body:        `An AI reply has been suggested for ticket #${ticketId}. Review and send if appropriate.`,
        entity_type: 'tickets',
        entity_id:   ticketId,
      }).catch(err => logger.warn({ err: err.message, ticketId }, 'aiReplyService: agent notification failed'));
    }
    logger.info({ orgId, ticketId, logId: logEntry.id }, 'aiReplyService: draft attached + agent notified (suggest)');
    return { skipped: false, logId: logEntry.id, draftText: finalText, action: 'proposed' };
  }

  if (mode === 'auto_send') {
    const autoThreshold = parseFloat(policy.auto_send_confidence) || 0.85;

    if (classification.confidence >= autoThreshold) {
      await TicketComment.create({
        ticket_id:   ticketId,
        user_id:     null,
        body:        finalText,
        is_internal: false,
      });
      await AiReplyLog.update(logEntry.id, { action: 'auto_sent', final_text: finalText });
      // Channel dispatch (WhatsApp, email, SMS) is handled by channel adapters
      // that consume this service's return value / events. We log the intent here.
      logger.info({ orgId, ticketId, channel, logId: logEntry.id }, 'aiReplyService: auto_sent via channel');
      return { skipped: false, logId: logEntry.id, draftText: finalText, action: 'auto_sent' };
    }

    // Confidence below threshold — fall back to suggest
    await Ticket.addComment({
      ticket_id:   ticketId,
      user_id:     null,
      body:        `[AI Suggested Reply]\n${finalText}`,
      is_internal: true,
    });
    if (ticket?.assigned_to) {
      const pct = Math.round(classification.confidence * 100);
      await Notification.create({
        user_id:     ticket.assigned_to,
        type:        'ticket',
        title:       `AI Reply Suggested (confidence ${pct}% < auto-send threshold)`,
        body:        `An AI reply was generated for ticket #${ticketId} but confidence (${pct}%) is below the auto-send threshold. Review and send if appropriate.`,
        entity_type: 'tickets',
        entity_id:   ticketId,
      }).catch(err => logger.warn({ err: err.message, ticketId }, 'aiReplyService: agent notification failed'));
    }
    logger.info({ orgId, ticketId, logId: logEntry.id }, 'aiReplyService: auto_send fell back to suggest (low confidence)');
    return { skipped: false, logId: logEntry.id, draftText: finalText, action: 'proposed' };
  }

  // Unknown mode — safe fallback
  logger.warn({ mode }, 'aiReplyService: unknown dispatch mode — defaulting to draft_only');
  await Ticket.addComment({
    ticket_id:   ticketId,
    user_id:     null,
    body:        `[AI Suggested Reply]\n${finalText}`,
    is_internal: true,
  });
  return { skipped: false, logId: logEntry.id, draftText: finalText, action: 'proposed' };
}

// =============================================================================
// Exports (internals exposed for unit testing)
// =============================================================================

module.exports = {
  generate,
  // Exported for testing
  _redactPii,
  _rehydratePii,
  _classifyMessage,
  _renderSystemPrompt,
  _validateOutput,
  _persistTriage,
};
