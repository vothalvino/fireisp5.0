// =============================================================================
// FireISP 5.0 — HTTP Request Logging Middleware
// =============================================================================
// Logs every request/response with method, url, status, and response time.
// =============================================================================

const logger = require('../utils/logger');

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

    logger[level]({
      requestId: req.id || null,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: duration,
      ip: req.ip,
      user_id: req.user?.id || null,
    }, `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
}

module.exports = { requestLogger };
