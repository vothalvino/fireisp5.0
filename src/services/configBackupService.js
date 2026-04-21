// =============================================================================
// FireISP 5.0 — Config Backup Service
// =============================================================================
// Provides functions to pull RouterOS configuration backups from remote
// MikroTik devices via the FireRelay WebSocket tunnel and persist them to
// the device_config_backups table.
//
// Environment variables used for nightly pulls:
//   ROUTEROS_API_USER       — RouterOS API username (default: 'admin')
//   ROUTEROS_API_PASSWORD   — RouterOS API password (required for nightly run)
//   ROUTEROS_API_PORT       — RouterOS API port (default: 8728)
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const { tunnelServer } = require('./firerelayTunnel');
const logger = require('../utils/logger').child({ service: 'configBackupService' });

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Return the latest version number for a device's config backups (or 0 if none).
 * @param {number} deviceId
 * @returns {Promise<number>}
 */
async function getLatestVersion(deviceId) {
  const [rows] = await db.query(
    'SELECT version FROM device_config_backups WHERE device_id = ? ORDER BY version DESC LIMIT 1',
    [deviceId],
  );
  return rows.length > 0 ? rows[0].version : 0;
}

/**
 * Return the checksum of the most recent backup for a device (or null if none).
 * @param {number} deviceId
 * @returns {Promise<string|null>}
 */
async function getLatestChecksum(deviceId) {
  const [rows] = await db.query(
    'SELECT checksum FROM device_config_backups WHERE device_id = ? ORDER BY version DESC LIMIT 1',
    [deviceId],
  );
  return rows.length > 0 ? rows[0].checksum : null;
}

/**
 * Compute the SHA-256 hex digest of a string.
 * @param {string} content
 * @returns {string}
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Pull a config backup for a single device via the FireRelay tunnel and store
 * it in device_config_backups.
 *
 * Deduplication: if the new checksum matches the latest stored backup, no new
 * row is written and the function returns { skipped: true }.
 *
 * @param {object} opts
 * @param {number}  opts.deviceId         - devices.id
 * @param {string}  opts.nodeId           - FireRelay agent node_id to route to
 * @param {string}  opts.host             - MikroTik device IP address
 * @param {string}  opts.user             - RouterOS API username
 * @param {string}  opts.password         - RouterOS API password
 * @param {number}  [opts.port]           - RouterOS API port (default 8728)
 * @param {boolean} [opts.compact]        - Use compact export (default false)
 * @param {string}  [opts.captureMethod]  - 'manual' | 'scheduled' (default 'scheduled')
 * @param {number|null} [opts.capturedByUserId] - User who triggered; null = system
 * @param {string}  [opts.notes]          - Optional notes
 * @returns {Promise<{ backupId: number, version: number, skipped: boolean, checksum: string }>}
 */
async function pullBackupForDevice({
  deviceId,
  nodeId,
  host,
  user,
  password,
  port,
  compact = false,
  captureMethod = 'scheduled',
  capturedByUserId = null,
  notes = null,
}) {
  if (!deviceId) throw new Error('deviceId is required');
  if (!nodeId) throw new Error('nodeId is required');
  if (!host) throw new Error('host is required');
  if (!user) throw new Error('user is required');
  if (password === undefined || password === null) throw new Error('password is required');

  // Send config.backup command through the tunnel
  const params = { host, user, password, compact };
  if (port) params.port = port;

  const { content, configType } = await tunnelServer.sendCommand(nodeId, 'config.backup', params);

  const checksum = sha256(content);
  const fileSize = Buffer.byteLength(content, 'utf8');

  // Deduplication: skip if content hasn't changed
  const latestChecksum = await getLatestChecksum(deviceId);
  if (latestChecksum && latestChecksum === checksum) {
    logger.debug({ deviceId, nodeId, checksum }, 'Config backup unchanged — skipping');
    return { backupId: null, version: null, skipped: true, checksum };
  }

  const nextVersion = (await getLatestVersion(deviceId)) + 1;

  const [result] = await db.query(
    `INSERT INTO device_config_backups
       (device_id, version, config_type, content, file_size, checksum,
        capture_method, captured_by_user_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deviceId,
      nextVersion,
      configType,
      content,
      fileSize,
      checksum,
      captureMethod,
      capturedByUserId,
      notes,
    ],
  );

  logger.info(
    { deviceId, nodeId, version: nextVersion, configType, fileSize, checksum },
    'Config backup stored',
  );

  return {
    backupId: result.insertId,
    version: nextVersion,
    skipped: false,
    checksum,
    configType,
    fileSize,
  };
}

/**
 * Run nightly automated config backup pull for all eligible devices.
 *
 * Eligible devices: deleted_at IS NULL, firerelay_node_id IS NOT NULL,
 * ip_address IS NOT NULL.
 *
 * RouterOS credentials come from environment variables:
 *   ROUTEROS_API_USER     (default 'admin')
 *   ROUTEROS_API_PASSWORD (required)
 *   ROUTEROS_API_PORT     (default 8728)
 *
 * Per-device errors are logged and counted but do not abort the entire run.
 *
 * @param {number|null} [organizationId] - optional scope (not used for device selection
 *                                         but reserved for future org-scoped runs)
 * @returns {Promise<{ total: number, backed_up: number, skipped: number, failed: number }>}
 */
async function runNightlyBackups(organizationId = null) {
  const user = process.env.ROUTEROS_API_USER || 'admin';
  const password = process.env.ROUTEROS_API_PASSWORD;
  const port = process.env.ROUTEROS_API_PORT ? parseInt(process.env.ROUTEROS_API_PORT, 10) : undefined;

  if (!password) {
    logger.warn('ROUTEROS_API_PASSWORD not set — config_backup_pull task will not run');
    return { total: 0, backed_up: 0, skipped: 0, failed: 0 };
  }

  const orgFilter = organizationId ? 'AND c.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [devices] = await db.query(
    `SELECT d.id, d.name, d.ip_address, d.firerelay_node_id
       FROM devices d
       ${organizationId ? 'JOIN clients c ON d.client_id = c.id' : ''}
      WHERE d.firerelay_node_id IS NOT NULL
        AND d.ip_address IS NOT NULL
        AND d.deleted_at IS NULL
        ${orgFilter}`,
    params,
  );

  const stats = { total: devices.length, backed_up: 0, skipped: 0, failed: 0 };

  for (const device of devices) {
    if (!tunnelServer.isConnected(device.firerelay_node_id)) {
      logger.warn(
        { deviceId: device.id, nodeId: device.firerelay_node_id },
        'Agent not connected — skipping device config backup',
      );
      stats.failed += 1;
      continue;
    }

    try {
      const result = await pullBackupForDevice({
        deviceId: device.id,
        nodeId: device.firerelay_node_id,
        host: device.ip_address,
        user,
        password,
        port,
        captureMethod: 'scheduled',
      });

      if (result.skipped) {
        stats.skipped += 1;
      } else {
        stats.backed_up += 1;
      }
    } catch (err) {
      logger.error(
        { deviceId: device.id, nodeId: device.firerelay_node_id, err: err.message },
        'Config backup failed for device',
      );
      stats.failed += 1;
    }
  }

  logger.info(stats, 'Nightly config backup pull complete');
  return stats;
}

module.exports = {
  pullBackupForDevice,
  runNightlyBackups,
  // exported for testing
  sha256,
  getLatestVersion,
  getLatestChecksum,
};
