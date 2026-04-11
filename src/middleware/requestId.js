// =============================================================================
// FireISP 5.0 — Request ID Middleware
// =============================================================================
// Generates a unique request ID for every incoming request and attaches it
// to the request object, response headers, and Pino logger context.
// Uses crypto.randomUUID() (Node 18+) for fast, collision-free IDs.
// =============================================================================

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Middleware that assigns a unique request ID.
 * - Reads X-Request-Id header if present (for upstream tracing).
 * - Otherwise generates a new UUID v4.
 * - Attaches to req.id, res header, and creates a child logger on req.log.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);

  // Create a child logger with the request ID bound
  req.log = logger.child({ requestId: id });

  next();
}

module.exports = { requestId };
