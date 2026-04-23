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
