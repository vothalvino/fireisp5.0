// =============================================================================
// FireISP 5.0 — FireRelay Middleware
// =============================================================================
// Express middleware mounted before all routes.
//
// In standalone mode: calls next() immediately — zero overhead.
// In master mode:     inspects the request, looks up the routing table,
//                     proxies or fans out as needed.
// In worker mode:     calls next() — requests arrive already routed from
//                     the master.
//
// Standalone mode is included from day one so that the middleware slot exists
// in the Express stack. When master/worker logic is added later, no refactor
// of the app.js middleware order is required.
// =============================================================================

const relayConfig = require('../config/firerelay');
const logger = require('../utils/logger');

/**
 * Extract a client_id from a request path like /api/clients/123 or
 * /api/v1/clients/123.  Returns null if the path does not target a
 * specific client resource.
 */
function extractClientId(urlPath) {
  const match = urlPath.match(/\/api(?:\/v1)?\/clients\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Determine if this request is a list/search query that should be fanned out
 * to all nodes.  Only GET requests on collection endpoints qualify.
 */
function isFanOutRequest(method, urlPath) {
  if (method !== 'GET') return false;
  // Collection endpoints: /api/clients, /api/v1/clients (no trailing id)
  return /\/api(?:\/v1)?\/clients\/?(\?|$)/.test(urlPath);
}

/**
 * FireRelay middleware factory.
 * Returns a no-op pass-through in standalone and worker modes.
 * Master mode routes requests to the correct worker node.
 */
function firerelay(req, res, next) {
  // Standalone & worker: pass through immediately
  if (relayConfig.mode === 'standalone' || relayConfig.mode === 'worker') {
    return next();
  }

  // Master mode — mark the request and handle locally.
  // Proxy/fan-out is triggered by the route layer via firerelayService
  // when it detects the request targets a remote client. The middleware
  // sets the flag so downstream code can check it.
  req.firerelayMode = 'master';
  return next();
}

// Log the active mode once at require-time so operators can verify it
if (relayConfig.mode !== 'standalone') {
  logger.info(
    { mode: relayConfig.mode, nodeId: relayConfig.nodeId || '(master)' },
    'FireRelay active',
  );
}

module.exports = { firerelay, extractClientId, isFanOutRequest };
