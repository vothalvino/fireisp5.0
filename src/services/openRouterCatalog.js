// =============================================================================
// FireISP 5.0 — OpenRouter model catalog
// =============================================================================
// OpenRouter fronts hundreds of models from many vendors, and the roster changes
// most weeks. A hardcoded list is stale by the next release and quietly denies
// operators the model they are paying for, so the catalog is fetched from
// OpenRouter's PUBLIC model endpoint and cached.
//
// WHY THE BACKEND FETCHES IT, not the browser:
//   • one fetch serves every admin in every org, instead of one per page view
//   • the page's CSP does not have to allow a third-party origin
//   • an air-gapped install fails in one place, with one clear message
//
// WHEN IT FETCHES: only while an admin is actually configuring an OpenRouter
// provider. There is no timer and no startup call. An install that never touches
// OpenRouter never contacts openrouter.ai — the same rule the update check
// follows, and the reason a billing system can pass a security review.
//
// The endpoint needs no credentials, so no key is sent and nothing identifies
// the install.
//
// PRICING COMES FROM THE SAME PAYLOAD, and that matters beyond the picker:
// llmProviderService's static PRICE_TABLE knows none of these models, so every
// OpenRouter call would log "unknown model" and record cost 0 — silently wrong
// numbers on the cost dashboard. Rates are per-token and quoted separately for
// prompt and completion, so they are also more accurate than the single blended
// figure the static table uses.
// =============================================================================

const logger = require('../utils/logger').child({ service: 'openRouterCatalog' });

const MODELS_URL = process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models';

// How long a successful fetch is served from memory. The roster moves in days,
// not seconds; an admin who needs a just-released model can force a refresh.
const TTL_MS = 60 * 60 * 1000;

// A failure is cached far more briefly, so a transient outage does not pin the
// picker to an error for an hour — but a hard-down endpoint is not re-hammered
// on every keystroke either.
const ERROR_TTL_MS = 60 * 1000;

const FETCH_TIMEOUT_MS = 10000;

// Guards against a malformed or hostile payload turning into unbounded memory.
// OpenRouter listed ~340 models when this was written.
const MAX_MODELS = 2000;

let cache = null; // { at: number, models: [], error: string|null }
let inFlight = null;

/** Coerce OpenRouter's string-encoded per-token rate to a number. */
function _rate(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Reduce a catalog entry to the fields the UI and cost accounting need.
 * Everything else in OpenRouter's payload (descriptions, architecture blobs) is
 * dropped — it would be sent to every browser for no benefit.
 */
function _normalise(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;

  const pricing = raw.pricing || {};
  const prompt = _rate(pricing.prompt);
  const completion = _rate(pricing.completion);

  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    context_length: Number.isFinite(raw.context_length) ? raw.context_length : null,
    // Per TOKEN, as OpenRouter quotes them. Converted where cost is computed.
    prompt_price: prompt,
    completion_price: completion,
    // A model is only "free" when both rates are known AND zero. An unknown
    // rate must never render as free — that would read as "costs nothing".
    free: prompt === 0 && completion === 0,
  };
}

async function _fetchCatalog() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`OpenRouter returned HTTP ${res.status}`);

    const body = await res.json();
    const list = Array.isArray(body?.data) ? body.data : null;
    if (!list) throw new Error('OpenRouter response had no data array');

    const models = list
      .slice(0, MAX_MODELS)
      .map(_normalise)
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (!models.length) throw new Error('OpenRouter returned no usable models');
    return models;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The catalog, from cache when fresh.
 *
 * NEVER THROWS. A provider picker that 500s because a third party is down is
 * worse than one that says so and still lets the model be typed in by hand, so
 * failure is returned as data: { models: [], error, stale }.
 *
 * Concurrent callers share one in-flight request — a page with several admins
 * on it must not produce several outbound calls.
 */
async function getModels({ force = false } = {}) {
  const now = Date.now();

  if (!force && cache) {
    const ttl = cache.error ? ERROR_TTL_MS : TTL_MS;
    if (now - cache.at < ttl) {
      return { models: cache.models, error: cache.error, cached_at: cache.at, stale: false };
    }
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const models = await _fetchCatalog();
      cache = { at: Date.now(), models, error: null };
      logger.info({ count: models.length }, 'openRouterCatalog: catalog refreshed');
      return { models, error: null, cached_at: cache.at, stale: false };
    } catch (err) {
      const message = err.name === 'AbortError'
        ? `Timed out after ${FETCH_TIMEOUT_MS}ms`
        : err.message;
      logger.warn({ err: message }, 'openRouterCatalog: could not refresh catalog');

      // Serve the last good catalog rather than nothing. A stale list is far
      // more useful than an empty one, and the caller is told it is stale.
      if (cache && cache.models.length) {
        cache = { ...cache, at: Date.now(), error: message };
        return { models: cache.models, error: message, cached_at: cache.at, stale: true };
      }
      cache = { at: Date.now(), models: [], error: message };
      return { models: [], error: message, cached_at: cache.at, stale: false };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * USD cost for one call, from the live per-token rates.
 *
 * Returns null when the model is not in the catalog, which the caller must
 * distinguish from 0 — "free" and "unknown" are different facts, and conflating
 * them is how a cost dashboard ends up confidently reporting zero.
 */
function estimateCost(modelId, promptTokens, completionTokens) {
  if (!cache || !cache.models.length) return null;
  const model = cache.models.find((m) => m.id === modelId);
  if (!model || model.prompt_price === null || model.completion_price === null) return null;

  const cost = (promptTokens || 0) * model.prompt_price
    + (completionTokens || 0) * model.completion_price;

  // 6dp matches llmProviderService's USD micro-cent precision.
  return Math.round(cost * 1e6) / 1e6;
}

/** Test seam: drop all cached state. */
function _resetCache() {
  cache = null;
  inFlight = null;
}

module.exports = { getModels, estimateCost, _resetCache, MODELS_URL, TTL_MS, ERROR_TTL_MS };
