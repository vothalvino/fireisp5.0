'use strict';

const config = require('../config');
const db = require('../config/database');
const wireguard = require('./wireguardServerService');
const nasPeers = require('./wgProvisioningService');
const userPeers = require('./userTunnelService');
const logger = require('../utils/logger').child({ service: 'wireguardRuntime' });

const SETTING_KEY = 'wireguard_server_enabled';

function parseEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function isEnabled() {
  return Boolean(config.wireguard.serverEnabled);
}

async function activate() {
  config.wireguard.serverEnabled = true;
  try {
    let lastError;
    // The helper and app start together. Give its Unix socket a short bounded
    // readiness window instead of making the public API depend on start order.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const result = await wireguard.bootstrapHost();
        if (!result.applied) throw new Error('WireGuard helper could not create both hub interfaces');
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    if (lastError) throw lastError;
    await nasPeers.rehydrateNasPeers();
    await userPeers.rehydrateUserPeers();
  } catch (err) {
    await wireguard.shutdownHost().catch(() => {});
    config.wireguard.serverEnabled = false;
    throw err;
  }
}

async function setEnabled(enabled) {
  if (enabled === isEnabled()) return { enabled };
  if (enabled) {
    await activate();
  } else {
    await wireguard.shutdownHost();
    config.wireguard.serverEnabled = false;
  }
  return { enabled: isEnabled() };
}

async function initialize() {
  const [rows] = await db.withPrimaryContext(() => db.query(
    'SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1',
    [SETTING_KEY],
  ));
  let stored = rows[0]?.setting_value;
  if (stored === 'migrate') {
    // Previous production Compose defaulted the hub ON when the variable was
    // absent. Fresh installers now write an explicit false marker. Resolve that
    // legacy state once, then persist a normal boolean so the GUI remains the
    // sole authority on every later restart.
    const legacy = process.env.WG_LEGACY_SERVER_ENABLED;
    const enabledFromLegacy = legacy === '__unset__' || parseEnabled(legacy);
    stored = enabledFromLegacy ? 'true' : 'false';
    await db.withPrimaryContext(() => db.query(
      'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
      [stored, SETTING_KEY],
    ));
  }
  const enabled = parseEnabled(stored);
  config.wireguard.serverEnabled = false;
  if (!enabled) {
    logger.info('WireGuard hub disabled by installation setting');
    return { enabled: false };
  }
  await activate();
  logger.info('WireGuard hub enabled by installation setting');
  return { enabled: true };
}

function publicDetails() {
  return {
    enabled: isEnabled(),
    endpoint: config.wireguard.serverEndpoint || null,
    nasPort: config.wireguard.serverListenPort,
    clientPort: config.wireguard.clientListenPort,
  };
}

module.exports = { SETTING_KEY, initialize, setEnabled, isEnabled, publicDetails, parseEnabled };
