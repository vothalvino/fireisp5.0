// =============================================================================
// FireISP 5.0 — Error Tracking (Sentry)
// =============================================================================
// Wraps @sentry/node so that error tracking is opt-in: set SENTRY_DSN to enable.
// When SENTRY_DSN is not set all exported functions are no-ops (zero overhead).
//
// Usage:
//   const errorTracking = require('./utils/errorTracking');
//   errorTracking.captureException(err, { requestId: req.id });
//   errorTracking.setupExpressErrorHandler(app); // after all routes
// =============================================================================

let _sentry = null;
let _enabled = false;

const FILTERED = '[Filtered]';
const SENSITIVE_EVENT_KEY = /(?:^|_)(?:authorization|proxy_authorization|cookie|cookies|set_cookie|headers|password|passwd|secret|secret_encrypted|client_secret|token|access_token|refresh_token|api_key|session|session_id|credential|dsn|forward_to_url|target_url|url|uri|host|hostname|address|target|email|payload|body|raw_body|request_body|data|query|query_string)(?:_|$)/i;

function isSensitiveEventKey(key) {
  const normalized = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_');
  return SENSITIVE_EVENT_KEY.test(normalized);
}

function redactText(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${FILTERED}`)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[Filtered URL]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[Filtered Email]');
}

function sanitizeEventValue(value, seen = new WeakSet(), depth = 0) {
  if (depth > 20) return FILTERED;
  if (typeof value === 'string') return redactText(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (seen.has(value)) return FILTERED;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => sanitizeEventValue(item, seen, depth + 1));
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveEventKey(key)
      ? FILTERED
      : sanitizeEventValue(item, seen, depth + 1);
  }
  return output;
}

/**
 * Sentry events leave the FireISP trust boundary. Keep diagnostics useful but
 * never export authenticated request material or secret-bearing endpoints.
 */
function sanitizeEvent(event) {
  try {
    const safe = sanitizeEventValue(event);
    if (safe.request) {
      // Method is sufficient to group server failures. Raw URLs, query strings,
      // headers, cookies and parsed/raw bodies are deliberately not exported.
      safe.request = safe.request.method ? { method: safe.request.method } : {};
    }
    if (typeof safe.transaction === 'string') {
      const method = safe.transaction.match(/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/i)?.[1];
      safe.transaction = method ? `${method.toUpperCase()} [Filtered Transaction]` : '[Filtered Transaction]';
    }
    return safe;
  } catch (_err) {
    // Error reporting must fail closed: dropping one diagnostic is safer than
    // leaking an operator credential when an unexpected event shape appears.
    return null;
  }
}

/**
 * Initialise Sentry if SENTRY_DSN is present in the environment.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function init() {
  if (_enabled) return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    _sentry = require('@sentry/node');
    _sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      maxIncomingRequestBodySize: 'none',
      integrations(defaultIntegrations) {
        const safeIntegrations = (defaultIntegrations || [])
          .filter(integration => integration?.name !== 'RequestData' && integration?.name !== 'Http');
        if (typeof _sentry.requestDataIntegration === 'function') {
          safeIntegrations.push(_sentry.requestDataIntegration({
            include: {
              cookies: false,
              data: false,
              headers: false,
              ip: false,
              query_string: false,
              url: false,
            },
          }));
        }
        if (typeof _sentry.httpIntegration === 'function') {
          safeIntegrations.push(_sentry.httpIntegration({
            maxIncomingRequestBodySize: 'none',
            breadcrumbs: false,
            spans: false,
            tracePropagation: false,
          }));
        }
        return safeIntegrations;
      },
      beforeSend: sanitizeEvent,
      beforeSendTransaction: sanitizeEvent,
      // Disable performance tracing by default; set SENTRY_TRACES_SAMPLE_RATE to enable.
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0'),
    });
    _enabled = true;
  } catch (_err) {
    // Package not installed or init failed — degrade gracefully.
    _sentry = null;
    _enabled = false;
  }
}

// Auto-initialise at module load so that Sentry is active as early as possible.
init();

/**
 * Returns true when Sentry has been successfully initialised.
 * @returns {boolean}
 */
function isEnabled() {
  return _enabled;
}

/**
 * Capture an exception and send it to Sentry.
 * No-op when error tracking is disabled.
 *
 * @param {Error}  err
 * @param {Object} [extras] - Additional key/value pairs attached to the event.
 */
function captureException(err, extras) {
  if (!_enabled || !_sentry) return;

  if (extras && Object.keys(extras).length > 0) {
    _sentry.withScope((scope) => {
      scope.setExtras(extras);
      _sentry.captureException(err);
    });
  } else {
    _sentry.captureException(err);
  }
}

/**
 * Attach Sentry's Express error handler to the application.
 * Must be called AFTER all routes and BEFORE your own error handlers so that
 * Sentry can record the error before the response is sent.
 * No-op when error tracking is disabled.
 *
 * @param {import('express').Application} app
 */
function setupExpressErrorHandler(app) {
  if (!_enabled || !_sentry) return;
  _sentry.setupExpressErrorHandler(app);
}

/**
 * Internal helper — resets module state for unit tests.
 * Not intended for production use.
 * @private
 */
function _reset() {
  _sentry = null;
  _enabled = false;
}

module.exports = { init, isEnabled, captureException, setupExpressErrorHandler, _reset };
