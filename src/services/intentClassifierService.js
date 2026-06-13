// =============================================================================
// FireISP 5.0 — Intent Classifier Service (§21.2)
// =============================================================================
// Classifies customer support text into intent categories.
//
// Public API:
//   classify(text, providerId) → { intent, confidence, entities }
//   sanitize(text) → sanitized string (strips prompt injection, PII tokens, limits length)
//
// Intents: 'billing' | 'technical' | 'general' | 'other'
// =============================================================================

const logger = require('../utils/logger').child({ service: 'intentClassifierService' });

// ---------------------------------------------------------------------------
// Sanitization patterns
// ---------------------------------------------------------------------------

// Prompt injection attempts — case-insensitive
const INJECTION_RE = /\b(ignore|forget|disregard)\s+(previous|prior|above|all)\b/gi;

// Script tags (partial matches: opening tag, possibly without closing >)
const SCRIPT_TAG_RE = /<script[\s\S]*?(?:>|$)/gi;

// Maximum character length before truncation
const MAX_TEXT_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Keyword lists for fallback classification
// ---------------------------------------------------------------------------

const BILLING_RE  = /factura|pago|cobro|saldo|balance|invoice|payment|cargo|adeudo|recibo|plan|costo|precio/i;
const TECHNICAL_RE = /lento|internet|conexion|wifi|señal|slow|disconn|no funciona|signal|velocidad|caido|caida|reiniciar|router|modem|ping|latencia/i;
const GENERAL_RE  = /horario|oficina|direccion|numero|contacto|sucursal|soporte|ayuda|informacion/i;

// ---------------------------------------------------------------------------
// sanitize
// ---------------------------------------------------------------------------

/**
 * Sanitize customer text before classification or LLM submission.
 *
 * Removes:
 *  • Prompt injection phrases ("ignore previous instructions", etc.)
 *  • <script> tags / fragments
 * Truncates to MAX_TEXT_LENGTH characters.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitize(text) {
  if (typeof text !== 'string') return '';

  let result = text;

  // Reset stateful global regexes before use
  INJECTION_RE.lastIndex = 0;
  SCRIPT_TAG_RE.lastIndex = 0;

  result = result.replace(INJECTION_RE, '');
  result = result.replace(SCRIPT_TAG_RE, '');
  result = result.slice(0, MAX_TEXT_LENGTH);

  return result;
}

// ---------------------------------------------------------------------------
// Keyword-based fallback classifier
// ---------------------------------------------------------------------------

/**
 * Classify sanitized text using keyword matching only.
 *
 * Matching order: billing → technical → general → other
 *
 * @param {string} sanitizedText
 * @returns {{ intent: string, confidence: number, entities: object }}
 */
function _keywordClassify(sanitizedText) {
  let intent;

  if (BILLING_RE.test(sanitizedText)) {
    intent = 'billing';
  } else if (TECHNICAL_RE.test(sanitizedText)) {
    intent = 'technical';
  } else if (GENERAL_RE.test(sanitizedText)) {
    intent = 'general';
  } else {
    intent = 'other';
  }

  const confidence = intent === 'other' ? 0.50 : 0.85;
  return { intent, confidence, entities: {} };
}

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

/**
 * Classify customer support text into an intent category.
 *
 * When a providerId is supplied the function attempts an LLM call first.
 * On any LLM error it falls through to keyword-based classification.
 *
 * @param {string}      text        — raw customer text
 * @param {number|null} [providerId] — ai_providers.id to use; falsy = keyword-only
 * @returns {Promise<{ intent: string, confidence: number, entities: object }>}
 */
async function classify(text, providerId) {
  const sanitized = sanitize(text);

  if (providerId) {
    try {
      const llmProviderService = require('./llmProviderService');

      const prompt = `You are an intent classifier for ISP customer support.
Classify the following message into exactly one of these intents:
  - billing    (invoices, payments, charges, balances, plans, pricing)
  - technical  (connectivity, speed, router, modem, Wi-Fi, outages, diagnostics)
  - general    (office hours, address, contact information, general help)
  - other      (anything that does not fit the above)

Also extract any named entities (e.g. account numbers, device names) found in the text.

Respond with ONLY valid JSON — no markdown, no extra text — in this exact shape:
{
  "intent":     "<billing|technical|general|other>",
  "confidence": <float 0.0–1.0>,
  "entities":   {}
}

Customer message:
${sanitized}`;

      const result = await llmProviderService.chat({
        providerId,
        messages: [{ role: 'user', content: prompt }],
        jsonSchema: { intent: 'string', confidence: 'number', entities: 'object' },
      });

      const parsed = result.json || {};

      const VALID_INTENTS = new Set(['billing', 'technical', 'general', 'other']);
      const intent     = VALID_INTENTS.has(parsed.intent) ? parsed.intent : null;
      const confidence = Number.isFinite(parseFloat(parsed.confidence))
        ? Math.min(1, Math.max(0, parseFloat(parsed.confidence)))
        : null;

      if (intent !== null && confidence !== null) {
        const entities = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {};
        logger.debug({ intent, confidence, providerId }, 'intentClassifierService: LLM classification success');
        return { intent, confidence, entities };
      }

      logger.warn({ parsed, providerId }, 'intentClassifierService: LLM returned invalid shape — falling back to keywords');
    } catch (err) {
      logger.warn({ err: err.message, providerId }, 'intentClassifierService: LLM classification failed — falling back to keywords');
    }
  }

  // Keyword fallback
  return _keywordClassify(sanitized);
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  sanitize,
  classify,
  // Exposed for unit testing
  _keywordClassify,
};
