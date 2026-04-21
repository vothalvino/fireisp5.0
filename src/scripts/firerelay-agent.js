// =============================================================================
// FireISP 5.0 — FireRelay Agent Process
// =============================================================================
// Runs on remote POP-site nodes. Connects outbound to the master tunnel and
// waits for command messages from FireRelay.
// =============================================================================

require('dotenv').config();
const FireRelayAgent = require('../services/firerelayAgent');
const relayConfig = require('../config/firerelay');
const logger = require('../utils/logger').child({ script: 'firerelay-agent' });

function deriveTunnelUrl() {
  if (process.env.FIRERELAY_TUNNEL_URL) return process.env.FIRERELAY_TUNNEL_URL;
  if (!relayConfig.masterUrl) return '';

  try {
    const master = new URL(relayConfig.masterUrl);
    master.protocol = master.protocol === 'https:' ? 'wss:' : 'ws:';
    master.pathname = '/ws/firerelay';
    master.search = '';
    master.hash = '';
    return master.toString();
  } catch (_err) {
    return '';
  }
}

function buildAgent() {
  const tunnelUrl = deriveTunnelUrl();

  return new FireRelayAgent({
    nodeId: relayConfig.nodeId,
    token: relayConfig.tunnelSecret,
    tunnelUrl,
    reconnectDelayMs: parseInt(process.env.FIRERELAY_AGENT_RECONNECT_MS || '2000', 10),
    handlers: {},
    logger: logger.child({ component: 'agent' }),
  });
}

async function main() {
  const agent = buildAgent();

  try {
    await agent.start();
  } catch (err) {
    logger.fatal({ err: err.message }, 'Failed to start FireRelay agent');
    process.exit(1);
  }

  function gracefulShutdown(signal) {
    logger.info({ signal }, 'Stopping FireRelay agent');
    agent.stop().finally(() => process.exit(0));
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

if (require.main === module) {
  main();
}

module.exports = { deriveTunnelUrl, buildAgent, main };
