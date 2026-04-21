// =============================================================================
// FireISP 5.0 — FireRelay Configuration
// =============================================================================
// Reads FIRERELAY_* environment variables and exports a single config object.
// All values have safe defaults — standalone mode requires no configuration.
// =============================================================================

const VALID_MODES = ['standalone', 'master', 'worker'];

const mode = (process.env.FIRERELAY_MODE || 'standalone').toLowerCase();

if (!VALID_MODES.includes(mode)) {
  throw new Error(
    `Invalid FIRERELAY_MODE "${process.env.FIRERELAY_MODE}". ` +
    `Must be one of: ${VALID_MODES.join(', ')}`,
  );
}

/**
 * Parse the FIRERELAY_NODES JSON array safely.
 * Returns [] for standalone/worker modes or if the value is empty/invalid.
 */
function parseNodes(raw) {
  if (!raw || raw.trim() === '' || raw.trim() === '[]') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(url => typeof url === 'string' && url.length > 0);
  } catch (_err) {
    return [];
  }
}

module.exports = {
  mode,

  // Master-only settings
  nodes: parseNodes(process.env.FIRERELAY_NODES),
  healthInterval: parseInt(process.env.FIRERELAY_HEALTH_INTERVAL || '30000', 10),
  requestTimeout: parseInt(process.env.FIRERELAY_REQUEST_TIMEOUT || '5000', 10),
  maxRetries: parseInt(process.env.FIRERELAY_MAX_RETRIES || '3', 10),

  // Worker-only settings
  masterUrl: process.env.FIRERELAY_MASTER_URL || '',
  nodeId: process.env.FIRERELAY_NODE_ID || '',
  autoIncrementOffset: parseInt(process.env.FIRERELAY_AUTO_INCREMENT_OFFSET || '1', 10),

  // Capacity thresholds (all nodes)
  maxClients: parseInt(process.env.FIRERELAY_MAX_CLIENTS || '10000', 10),
  maxDevices: parseInt(process.env.FIRERELAY_MAX_DEVICES || '3000', 10),

  // WebSocket tunnel settings
  // FIRERELAY_TUNNEL_SECRET: shared secret agents must present during auth handshake.
  // If empty, tunnel is disabled.
  tunnelSecret: process.env.FIRERELAY_TUNNEL_SECRET || '',
  // How long to wait for an auth message from a newly-connected agent (ms)
  tunnelAuthTimeout: parseInt(process.env.FIRERELAY_TUNNEL_AUTH_TIMEOUT || '10000', 10),
  // How long to wait for a command response from an agent (ms)
  tunnelCommandTimeout: parseInt(process.env.FIRERELAY_TUNNEL_COMMAND_TIMEOUT || '10000', 10),
  // Interval for WebSocket ping/pong heartbeats (ms)
  tunnelPingInterval: parseInt(process.env.FIRERELAY_TUNNEL_PING_INTERVAL || '30000', 10),
};
