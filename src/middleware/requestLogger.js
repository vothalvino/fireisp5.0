// =============================================================================
// FireISP 5.0 — HTTP Request Logging Middleware
// =============================================================================
// Logs every request/response with method, url, status, and response time.
// =============================================================================

const logger = require('../utils/logger');

// Query parameters that are masked in log output to prevent leaking secrets.
const SENSITIVE_PARAMS = /[?&](password|token|api_key|secret|access_token|refresh_token)=[^&]*/gi;

/**
 * Mask sensitive query parameters in a URL.
 */
function maskUrl(url) {
  return url.replace(SENSITIVE_PARAMS, (match) => {
    const eqIdx = match.indexOf('=');
    return match.slice(0, eqIdx + 1) + '[REDACTED]';
  });
}

/**
 * Express middleware that logs each request on completion.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
        : 'info';

    const safeUrl = maskUrl(req.originalUrl);

    logger[level]({
      requestId: req.id || null,
      method: req.method,
      url: safeUrl,
      status: res.statusCode,
      duration_ms: duration,
      ip: req.ip,
      user_id: req.user?.id || null,
    }, `${req.method} ${safeUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
}

module.exports = { requestLogger, maskUrl };
