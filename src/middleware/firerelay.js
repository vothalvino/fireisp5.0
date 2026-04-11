// =============================================================================
// FireISP 5.0 — FireRelay Middleware
// =============================================================================
// Express middleware mounted before all routes.
//
// In standalone mode: calls next() immediately — zero overhead.
// In master mode:     (future) inspects the request, looks up the routing
//                     table, proxies or fans out as needed.
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
 * FireRelay middleware factory.
 * Returns a no-op pass-through in standalone and worker modes.
 * Master mode will add routing/proxy logic in a future release.
 */
function firerelay(req, _res, next) {
  // Standalone & worker: pass through immediately
  if (relayConfig.mode === 'standalone' || relayConfig.mode === 'worker') {
    return next();
  }

  // Master mode — placeholder for future proxy/fan-out logic.
  // For now, master also handles requests locally (same as standalone).
  // When the full relay service is implemented, this is where the routing
  // table lookup and HTTP proxy will be inserted.
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

module.exports = { firerelay };
