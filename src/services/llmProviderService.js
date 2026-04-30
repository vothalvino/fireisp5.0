// =============================================================================
// FireISP 5.0 — LLM Provider Service (P1 §3.4)
// =============================================================================
// Pluggable abstraction over multiple LLM providers.
//
// Public API:
//
//   chat({ providerId, messages, jsonSchema, signal })
//     → { text, json, usage:{prompt_tokens, completion_tokens}, cost_usd }
//
//   verify(providerId) → { ok: true, model, latency_ms }
//
// Supported provider kinds (dispatched from ai_providers.kind):
//   openai       — OpenAI API via `openai` npm SDK
//   azure_openai — OpenAI API via `openai` SDK with custom baseURL + api-version
//   anthropic    — Anthropic API via `@anthropic-ai/sdk`
//   gemini       — Google AI via `@google/generative-ai`
//   ollama       — local Ollama inference, plain fetch to endpoint_url
//   custom       — generic POST to endpoint_url with org-defined header map
//
// Security guarantees:
//   • API keys are decrypted from api_key_encrypted ONLY inside this module.
//   • Decrypted keys are never returned to callers, never logged.
//   • Pino's redact list already covers 'apiKey'/'api_key'; we additionally
//     ensure we never pass keys to logger ourselves.
//
// Retry / fallback:
//   • Up to 3 retries with exponential back-off (100 ms × 2^attempt) per provider.
//   • If the chosen provider exhausts retries, the fallback chain walks all
//     OTHER enabled providers in priority order.
//   • Errors from the chosen provider are recorded in the log context.
//
// Cost:
//   • Computed from a static price table (USD per 1 000 tokens) keyed by
//     (kind, model).  Unknown models default to $0 with a WARN log.
// =============================================================================

const AiProvider  = require('../models/AiProvider');
const { decrypt } = require('../utils/encryption');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'llmProviderService' });

// ---------------------------------------------------------------------------
// Retry config
// ---------------------------------------------------------------------------
const MAX_RETRIES    = 3;
const RETRY_BASE_MS  = 100;

// ---------------------------------------------------------------------------
// Price table  — USD per 1 000 tokens (combined input+output estimate)
// Prices are approximate and used only for cost tracking dashboards.
// ---------------------------------------------------------------------------
const PRICE_TABLE = {
  // OpenAI
  'gpt-4o':           0.005,
  'gpt-4o-mini':      0.00015,
  'gpt-4-turbo':      0.01,
  'gpt-4':            0.03,
  'gpt-3.5-turbo':    0.0005,
  // Anthropic
  'claude-3-5-sonnet-20241022': 0.003,
  'claude-3-5-haiku-20241022':  0.0008,
  'claude-3-opus-20240229':     0.015,
  'claude-3-sonnet-20240229':   0.003,
  'claude-3-haiku-20240307':    0.00025,
  // Google
  'gemini-1.5-pro':   0.00125,
  'gemini-1.5-flash': 0.000075,
  'gemini-2.0-flash': 0.0001,
  // Ollama / local
  'llama3.1:8b':      0,
  'llama3.2:3b':      0,
  'mistral:7b':       0,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute cost_usd from the price table.
 * Falls back to 0 with a warning when the model is not listed.
 */
// Module-scope so other functions added in the future can reuse
// the same 6-decimal (USD micro-cent) rounding precision.
const COST_PRECISION_MULTIPLIER = 1e6;

function _computeCost(kind, model, promptTokens, completionTokens) {
  const normalised = model ? model.toLowerCase() : '';
  const pricePerK  = PRICE_TABLE[normalised];

  if (pricePerK === undefined) {
    logger.warn({ kind, model }, 'llmProviderService: unknown model in price table — cost set to 0');
    return 0;
  }

  const totalTokens = (promptTokens || 0) + (completionTokens || 0);
  return Math.round((totalTokens / 1000) * pricePerK * COST_PRECISION_MULTIPLIER) / COST_PRECISION_MULTIPLIER;
}

/**
 * Sleep for `ms` milliseconds.
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse JSON from LLM output text, tolerating markdown code fences.
 */
function _parseJson(text) {
  if (!text) return null;
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/**
 * Build AbortSignal that fires after `timeoutMs` milliseconds,
 * optionally combining with a caller-supplied signal.
 */
function _buildSignal(timeoutMs, callerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs);

  if (callerSignal) {
    callerSignal.addEventListener('abort', () => {
      clearTimeout(timer);
      controller.abort(callerSignal.reason);
    });
  }

  return { signal: controller.signal, clearTimer: () => clearTimeout(timer) };
}

// ---------------------------------------------------------------------------
// Per-kind adapters
// ---------------------------------------------------------------------------

/**
 * Call OpenAI (or Azure OpenAI) using the official SDK.
 * Azure requires: provider.endpoint_url and extra_config.api_version
 */
async function _callOpenAI(provider, apiKey, messages, jsonSchema, signal) {
  const { OpenAI } = require('openai');

  const opts = {
    apiKey,
    timeout: provider.timeout_ms || 20000,
  };

  if (provider.kind === 'azure_openai') {
    const cfg = _parseExtraConfig(provider.extra_config);
    opts.baseURL    = provider.endpoint_url;
    opts.apiKey     = apiKey;
    opts.defaultHeaders = { 'api-key': apiKey };
    opts.defaultQuery   = { 'api-version': cfg.api_version || '2024-02-01' };
    // Azure uses apiKey in header, not Bearer
    opts.apiKey = undefined;
    opts.dangerouslyAllowBrowser = false;
  }

  const client = new OpenAI(opts);

  const params = {
    model:       provider.model,
    messages,
    temperature: parseFloat(provider.temperature) || 0.2,
    max_tokens:  provider.max_tokens || 800,
  };

  if (jsonSchema) {
    params.response_format = { type: 'json_object' };
  }

  const completion = await client.chat.completions.create(params, { signal });

  const choice = completion.choices[0];
  const text   = choice.message.content || '';
  const usage  = completion.usage || {};

  return {
    text,
    json:  jsonSchema ? _parseJson(text) : null,
    usage: {
      prompt_tokens:     usage.prompt_tokens     || 0,
      completion_tokens: usage.completion_tokens || 0,
    },
    cost_usd: _computeCost(provider.kind, provider.model, usage.prompt_tokens, usage.completion_tokens),
  };
}

/**
 * Call Anthropic using the official SDK.
 */
async function _callAnthropic(provider, apiKey, messages, jsonSchema, signal) {
  const Anthropic = require('@anthropic-ai/sdk');

  const client = new Anthropic.default({ apiKey, timeout: provider.timeout_ms || 20000 });

  // Anthropic separates system messages from the conversation turns
  let systemPrompt = '';
  const userMessages = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemPrompt += (systemPrompt ? '\n' : '') + m.content;
    } else {
      userMessages.push({ role: m.role, content: m.content });
    }
  }

  const params = {
    model:      provider.model,
    max_tokens: provider.max_tokens || 800,
    messages:   userMessages,
  };
  if (systemPrompt) params.system = systemPrompt;

  const response = await client.messages.create(params, { signal });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const inputTokens  = response.usage?.input_tokens  || 0;
  const outputTokens = response.usage?.output_tokens || 0;

  return {
    text,
    json: jsonSchema ? _parseJson(text) : null,
    usage: {
      prompt_tokens:     inputTokens,
      completion_tokens: outputTokens,
    },
    cost_usd: _computeCost(provider.kind, provider.model, inputTokens, outputTokens),
  };
}

/**
 * Call Google Gemini using the @google/generative-ai SDK.
 */
async function _callGemini(provider, apiKey, messages, jsonSchema, signal) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');

  const client = new GoogleGenerativeAI(apiKey);
  const model  = client.getGenerativeModel({
    model: provider.model,
    generationConfig: {
      temperature: parseFloat(provider.temperature) || 0.2,
      maxOutputTokens: provider.max_tokens || 800,
      ...(jsonSchema ? { responseMimeType: 'application/json' } : {}),
    },
  });

  // Build Gemini chat history + last user turn
  const history = [];
  let lastUserText = '';
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') {
      // Gemini doesn't have a system role in the chat history;
      // prepend system content to the first user message instead.
      continue;
    }
    if (i === messages.length - 1 && m.role === 'user') {
      lastUserText = m.content;
    } else {
      history.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
  }

  // Inject system content into first user message when present
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg && lastUserText) {
    lastUserText = `${systemMsg.content}\n\n${lastUserText}`;
  }

  const chat = model.startChat({ history });

  const abortPromise = signal
    ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Gemini request aborted'))))
    : null;

  const result = await (abortPromise
    ? Promise.race([chat.sendMessage(lastUserText || ''), abortPromise])
    : chat.sendMessage(lastUserText || ''));

  const text = result.response.text();

  // Gemini doesn't always expose token counts in non-streaming mode
  const promptTokens     = result.response.usageMetadata?.promptTokenCount     || 0;
  const completionTokens = result.response.usageMetadata?.candidatesTokenCount || 0;

  return {
    text,
    json: jsonSchema ? _parseJson(text) : null,
    usage: {
      prompt_tokens:     promptTokens,
      completion_tokens: completionTokens,
    },
    cost_usd: _computeCost(provider.kind, provider.model, promptTokens, completionTokens),
  };
}

/**
 * Call a local Ollama instance via plain fetch (OpenAI-compatible chat endpoint).
 */
async function _callOllama(provider, _apiKey, messages, jsonSchema, signal) {
  const baseUrl = (provider.endpoint_url || 'http://localhost:11434').replace(/\/$/, '');
  const url     = `${baseUrl}/api/chat`;

  const body = {
    model:    provider.model,
    messages,
    stream:   false,
    options: {
      temperature: parseFloat(provider.temperature) || 0.2,
      num_predict: provider.max_tokens || 800,
    },
  };

  if (jsonSchema) body.format = 'json';

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.message?.content || '';

  const promptTokens     = data.prompt_eval_count  || 0;
  const completionTokens = data.eval_count          || 0;

  return {
    text,
    json: jsonSchema ? _parseJson(text) : null,
    usage: {
      prompt_tokens:     promptTokens,
      completion_tokens: completionTokens,
    },
    cost_usd: _computeCost(provider.kind, provider.model, promptTokens, completionTokens),
  };
}

/**
 * Call a custom endpoint via POST.
 * The provider's extra_config.headers object is merged into the request.
 * Expected response shape (OpenAI-compatible):
 *   { choices: [{ message: { content } }], usage: { prompt_tokens, completion_tokens } }
 */
async function _callCustom(provider, apiKey, messages, jsonSchema, signal) {
  const cfg     = _parseExtraConfig(provider.extra_config);
  const headers = {
    'Content-Type': 'application/json',
    ...(cfg.headers || {}),
  };

  // Allow the org to define the auth header name (e.g. "Authorization", "x-api-key")
  if (apiKey) {
    const authHeader = cfg.auth_header || 'Authorization';
    headers[authHeader] = cfg.auth_prefix
      ? `${cfg.auth_prefix} ${apiKey}`
      : apiKey;
  }

  const body = {
    model:       provider.model,
    messages,
    temperature: parseFloat(provider.temperature) || 0.2,
    max_tokens:  provider.max_tokens || 800,
    ...(jsonSchema ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch(provider.endpoint_url, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Custom provider returned HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || data.content || '';
  const usage = data.usage || {};

  return {
    text,
    json: jsonSchema ? _parseJson(text) : null,
    usage: {
      prompt_tokens:     usage.prompt_tokens     || 0,
      completion_tokens: usage.completion_tokens || 0,
    },
    cost_usd: _computeCost(provider.kind, provider.model,
      usage.prompt_tokens, usage.completion_tokens),
  };
}

/**
 * Dispatch to the correct per-kind adapter.
 */
async function _callProviderOnce(provider, apiKey, messages, jsonSchema, signal) {
  switch (provider.kind) {
    case 'openai':
    case 'azure_openai':
      return _callOpenAI(provider, apiKey, messages, jsonSchema, signal);
    case 'anthropic':
      return _callAnthropic(provider, apiKey, messages, jsonSchema, signal);
    case 'gemini':
      return _callGemini(provider, apiKey, messages, jsonSchema, signal);
    case 'ollama':
      return _callOllama(provider, apiKey, messages, jsonSchema, signal);
    case 'custom':
      return _callCustom(provider, apiKey, messages, jsonSchema, signal);
    default:
      throw new AppError(`Unknown provider kind: ${provider.kind}`, 500, 'LLM_UNKNOWN_KIND');
  }
}

/**
 * Call a single provider with retry (exponential back-off, up to MAX_RETRIES).
 * Returns { result } on success, { error } on failure.
 */
async function _callWithRetry(provider, messages, jsonSchema, timeoutMs, callerSignal) {
  const apiKey = decrypt(provider.api_key_encrypted) || null;
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { signal, clearTimer } = _buildSignal(timeoutMs, callerSignal);
    try {
      const result = await _callProviderOnce(provider, apiKey, messages, jsonSchema, signal);
      clearTimer();
      return { result };
    } catch (err) {
      clearTimer();
      lastError = err;

      // Don't retry on abort/timeout from the caller
      if (callerSignal?.aborted) break;

      if (attempt < MAX_RETRIES - 1) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        logger.warn(
          { providerId: provider.id, kind: provider.kind, attempt: attempt + 1, delayMs: delay },
          'llmProviderService: retrying after error',
        );
        await _sleep(delay);
      }
    }
  }

  return { error: lastError };
}

// ---------------------------------------------------------------------------
// Parse extra_config safely
// ---------------------------------------------------------------------------
function _parseExtraConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

// =============================================================================
// Public API — chat
// =============================================================================

/**
 * Send a chat request to the given provider (with retry + fallback chain).
 *
 * @param {object}   opts
 * @param {number}   opts.providerId  — primary provider ID
 * @param {object[]} opts.messages    — OpenAI-format message array
 * @param {object}   [opts.jsonSchema] — when set, instructs the provider to return JSON
 * @param {AbortSignal} [opts.signal] — caller abort signal
 * @returns {Promise<{text:string, json:object|null, usage:{prompt_tokens:number,completion_tokens:number}, cost_usd:number}>}
 */
async function chat({ providerId, messages, jsonSchema = null, signal = null } = {}) {
  if (!providerId) throw new AppError('providerId is required', 400, 'LLM_MISSING_PROVIDER');
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError('messages must be a non-empty array', 400, 'LLM_MISSING_MESSAGES');
  }

  // --- Load the chosen provider ---
  const primary = await AiProvider.findById(providerId);
  if (!primary) {
    throw new AppError(`Provider ${providerId} not found`, 404, 'LLM_PROVIDER_NOT_FOUND');
  }

  const timeoutMs = primary.timeout_ms || 20000;
  const firstAttempt = await _callWithRetry(primary, messages, jsonSchema, timeoutMs, signal);

  if (firstAttempt.result) {
    logger.info({ providerId, kind: primary.kind, model: primary.model }, 'llmProviderService: chat success');
    return firstAttempt.result;
  }

  const primaryError = firstAttempt.error;
  logger.warn({ providerId, kind: primary.kind, err: primaryError?.message },
    'llmProviderService: primary provider failed — starting fallback chain');

  // --- Fallback: other enabled providers, ordered by priority ---
  const fallbacks = await AiProvider.findAll({
    where:   { enabled: 1 },
    orgId:   primary.organization_id,
    orderBy: 'priority',
    order:   'ASC',
    limit:   50,
  });

  for (const fallback of fallbacks) {
    if (fallback.id === primary.id) continue; // skip primary, already tried

    logger.info({ fallbackProviderId: fallback.id, kind: fallback.kind },
      'llmProviderService: trying fallback provider');

    const fallbackTimeout = fallback.timeout_ms || 20000;
    const attempt = await _callWithRetry(fallback, messages, jsonSchema, fallbackTimeout, signal);

    if (attempt.result) {
      logger.info({ fallbackProviderId: fallback.id, kind: fallback.kind },
        'llmProviderService: fallback succeeded');
      return attempt.result;
    }

    logger.warn({ fallbackProviderId: fallback.id, err: attempt.error?.message },
      'llmProviderService: fallback provider also failed');
  }

  // All providers failed
  throw new AppError(
    `All LLM providers failed. Primary error: ${primaryError?.message}`,
    502,
    'LLM_ALL_PROVIDERS_FAILED',
  );
}

// =============================================================================
// Public API — embed
// =============================================================================

// Default embedding models per provider kind
const EMBED_DEFAULT_MODELS = {
  openai:       'text-embedding-3-small',
  azure_openai: 'text-embedding-3-small',
  gemini:       'embedding-001',
  ollama:       'nomic-embed-text',
};

/**
 * Embed a text string using the given provider's embedding model.
 * Returns a number[] (the raw embedding vector).
 *
 * @param {string} text
 * @param {number} providerId
 * @returns {Promise<number[]>}
 */
async function embed(text, providerId) {
  if (!providerId) throw new AppError('providerId is required', 400, 'LLM_MISSING_PROVIDER');

  const provider = await AiProvider.findById(providerId);
  if (!provider) {
    throw new AppError(`Provider ${providerId} not found`, 404, 'LLM_PROVIDER_NOT_FOUND');
  }

  const apiKey = decrypt(provider.api_key_encrypted) || null;

  switch (provider.kind) {
    case 'openai':
    case 'azure_openai':
      return _embedOpenAI(provider, apiKey, text);
    case 'gemini':
      return _embedGemini(provider, apiKey, text);
    case 'ollama':
      return _embedOllama(provider, text);
    case 'anthropic':
      throw new AppError('Anthropic does not support embeddings', 400, 'LLM_EMBED_NOT_SUPPORTED');
    case 'custom':
      throw new AppError('Custom providers do not support embeddings', 400, 'LLM_EMBED_NOT_SUPPORTED');
    default:
      throw new AppError(`Unknown provider kind: ${provider.kind}`, 500, 'LLM_UNKNOWN_KIND');
  }
}

/**
 * Generate embeddings via OpenAI (or Azure OpenAI).
 */
async function _embedOpenAI(provider, apiKey, text) {
  const { OpenAI } = require('openai');
  const model = provider.embedding_model || EMBED_DEFAULT_MODELS[provider.kind];

  const opts = { apiKey, timeout: provider.timeout_ms || 20000 };

  if (provider.kind === 'azure_openai') {
    const cfg = _parseExtraConfig(provider.extra_config);
    opts.baseURL            = provider.endpoint_url;
    opts.defaultHeaders     = { 'api-key': apiKey };
    opts.defaultQuery       = { 'api-version': cfg.api_version || '2024-02-01' };
    opts.apiKey             = undefined;
    opts.dangerouslyAllowBrowser = false;
  }

  const client = new OpenAI(opts);
  const r = await client.embeddings.create({ model, input: text });
  return r.data[0].embedding;
}

/**
 * Generate embeddings via Google Gemini.
 */
async function _embedGemini(provider, apiKey, text) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const model = provider.embedding_model || EMBED_DEFAULT_MODELS.gemini;

  const client = new GoogleGenerativeAI(apiKey);
  const m = client.getGenerativeModel({ model });
  const r = await m.embedContent(text);
  return r.embedding.values;
}

/**
 * Generate embeddings via a local Ollama instance.
 * Tries the v0.3+ /api/embed endpoint first; falls back to the legacy /api/embeddings.
 */
async function _embedOllama(provider, text) {
  const baseUrl = (provider.endpoint_url || 'http://localhost:11434').replace(/\/$/, '');
  const model   = provider.embedding_model || EMBED_DEFAULT_MODELS.ollama;

  try {
    const res = await fetch(`${baseUrl}/api/embed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
    // /api/embed uses `input` (v0.3+ field name, not the legacy `prompt`)
      body:    JSON.stringify({ model, input: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.embeddings[0];
  } catch {
    // Fallback to legacy endpoint
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`Ollama /api/embeddings returned HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.embedding;
  }
}

// =============================================================================
// Public API — verify
// =============================================================================

/**
 * Perform a minimal 1-token round-trip to verify a provider's connectivity.
 * Used by the admin UI's "Test connection" button.
 *
 * @param {number} providerId
 * @returns {Promise<{ok:boolean, model:string, latency_ms:number}>}
 */
async function verify(providerId) {
  const provider = await AiProvider.findById(providerId);
  if (!provider) {
    throw new AppError(`Provider ${providerId} not found`, 404, 'LLM_PROVIDER_NOT_FOUND');
  }

  const probe = [
    { role: 'user', content: 'Reply with exactly the word "ok" and nothing else.' },
  ];

  const start = Date.now();
  try {
    const apiKey = decrypt(provider.api_key_encrypted) || null;
    const { signal, clearTimer } = _buildSignal(provider.timeout_ms || 20000, null);

    // Use max_tokens override to keep it cheap
    const cheapProvider = { ...provider, max_tokens: 5 };
    const result = await _callProviderOnce(cheapProvider, apiKey, probe, null, signal);
    clearTimer();

    return { ok: true, model: provider.model, latency_ms: Date.now() - start };
  } catch (err) {
    logger.warn({ providerId, err: err.message }, 'llmProviderService: verify failed');
    throw new AppError(`Provider verification failed: ${err.message}`, 502, 'LLM_VERIFY_FAILED');
  }
}

// =============================================================================
// Exports (also export internals for testing)
// =============================================================================

module.exports = {
  chat,
  verify,
  embed,
  // Exported for testing
  _computeCost,
  _parseJson,
  _callOpenAI,
  _callAnthropic,
  _callGemini,
  _callOllama,
  _callCustom,
  _embedOpenAI,
  _embedGemini,
  _embedOllama,
};
