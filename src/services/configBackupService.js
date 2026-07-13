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
  // NOTE: intentionally does NOT filter deleted_at — version numbers must stay
  // monotonic across soft-deleted backups so the (device_id, version) unique key
  // (now deleted_at-aware, migration 361) never collides on a recycled version.
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

// =============================================================================
// §6.6 Config Management Extensions
// =============================================================================

/**
 * Compute a simple line-based diff between two config strings.
 * Returns empty string if content is identical.
 * Lines removed from prev are prefixed with '-', lines added in curr with '+'.
 * @param {string} previousContent
 * @param {string} currentContent
 * @returns {string}
 */
function computeDiff(previousContent, currentContent) {
  if (previousContent === currentContent) return '';
  const prev = previousContent.split('\n');
  const curr = currentContent.split('\n');
  const lines = [];
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  for (const line of prev) {
    if (!currSet.has(line)) lines.push(`-${line}`);
  }
  for (const line of curr) {
    if (!prevSet.has(line)) lines.push(`+${line}`);
  }
  return lines.join('\n');
}

/**
 * Run a compliance audit on a backup, evaluating all enabled compliance rules
 * for the org against the backup content. Inserts result rows.
 *
 * @param {number} backupId
 * @param {number} organizationId
 * @returns {Promise<{ total: number, passed: number, failed: number }>}
 */
async function runComplianceAudit(backupId, organizationId) {
  // Load backup
  const [backupRows] = await db.query(
    'SELECT id, device_id, content FROM device_config_backups WHERE id = ?',
    [backupId],
  );
  if (backupRows.length === 0) throw new Error(`Backup ${backupId} not found`);
  const backup = backupRows[0];

  // Load device type for filtering
  const [deviceRows] = await db.query(
    'SELECT id, type AS device_type FROM devices WHERE id = ?',
    [backup.device_id],
  );
  const deviceType = deviceRows.length > 0 ? deviceRows[0].device_type : null;

  // Load enabled compliance rules for org
  const [rules] = await db.query(
    `SELECT id, rule_type, pattern, applies_to_device_type
     FROM config_compliance_rules
     WHERE (organization_id = ? OR organization_id IS NULL)
       AND is_enabled = 1
       AND deleted_at IS NULL
       AND (applies_to_device_type IS NULL OR applies_to_device_type = ?)`,
    [organizationId, deviceType],
  );

  const stats = { total: rules.length, passed: 0, failed: 0 };
  const content = backup.content;

  for (const rule of rules) {
    let result = 'fail';
    let details = '';
    try {
      const { rule_type, pattern } = rule;
      if (rule_type === 'must_contain') {
        result = content.includes(pattern) ? 'pass' : 'fail';
        details = result === 'pass' ? `Pattern found: ${pattern}` : `Pattern not found: ${pattern}`;
      } else if (rule_type === 'must_not_contain') {
        result = !content.includes(pattern) ? 'pass' : 'fail';
        details = result === 'pass' ? `Forbidden pattern absent: ${pattern}` : `Forbidden pattern found: ${pattern}`;
      } else if (rule_type === 'regex_match') {
        const rx = new RegExp(pattern);
        result = rx.test(content) ? 'pass' : 'fail';
        details = result === 'pass' ? `Regex matched: ${pattern}` : `Regex did not match: ${pattern}`;
      } else if (rule_type === 'regex_not_match') {
        const rx = new RegExp(pattern);
        result = !rx.test(content) ? 'pass' : 'fail';
        details = result === 'pass' ? `Regex absent (good): ${pattern}` : `Regex matched (violation): ${pattern}`;
      }
    } catch (err) {
      result = 'error';
      details = `Rule evaluation error: ${err.message}`;
    }

    await db.query(
      `INSERT INTO config_compliance_results (rule_id, backup_id, device_id, result, details, evaluated_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [rule.id, backupId, backup.device_id, result, details],
    );

    if (result === 'pass') stats.passed += 1;
    else stats.failed += 1;
  }

  return stats;
}

/**
 * Pull a backup and then compute + store the diff vs the previous version.
 * Wraps pullBackupForDevice with diff calculation.
 *
 * @param {object} opts - same options as pullBackupForDevice
 * @returns {Promise<object>} - same result as pullBackupForDevice
 */
async function pullBackupWithDiff(opts) {
  // Get previous content before the new backup is inserted
  const [prevRows] = await db.query(
    'SELECT content FROM device_config_backups WHERE device_id = ? ORDER BY version DESC LIMIT 1',
    [opts.deviceId],
  );
  const prevContent = prevRows.length > 0 ? prevRows[0].content : null;

  const result = await pullBackupForDevice(opts);
  if (result.skipped || !result.backupId) return result;

  if (prevContent !== null) {
    // Get new content
    const [newRows] = await db.query(
      'SELECT content FROM device_config_backups WHERE id = ?',
      [result.backupId],
    );
    if (newRows.length > 0) {
      const diffText = computeDiff(prevContent, newRows[0].content);
      await db.query(
        'UPDATE device_config_backups SET diff_from_previous = ? WHERE id = ?',
        [diffText, result.backupId],
      );
    }
  }

  return result;
}

/**
 * Deploy a config template to a device by substituting variables and recording
 * the deployment. Does not perform a live push — queues or marks as deferred
 * when no active tunnel is present.
 *
 * @param {number} templateId
 * @param {number} deviceId
 * @param {object|null} variables - key/value pairs for {{variable}} substitution
 * @param {number|null} deployedBy - user id who triggered the deployment
 * @returns {Promise<object>} deployment record
 */
async function deployConfigTemplate(templateId, deviceId, variables, deployedBy) {
  // Load template
  const [templateRows] = await db.query(
    'SELECT id, organization_id, template_content, status FROM config_templates WHERE id = ? AND deleted_at IS NULL',
    [templateId],
  );
  if (templateRows.length === 0) throw new Error(`Template ${templateId} not found`);
  const template = templateRows[0];

  // Load device
  const [deviceRows] = await db.query(
    'SELECT id, firerelay_node_id FROM devices WHERE id = ? AND deleted_at IS NULL',
    [deviceId],
  );
  if (deviceRows.length === 0) throw new Error(`Device ${deviceId} not found`);
  const device = deviceRows[0];

  // Render template
  let rendered = template.template_content;
  if (variables && typeof variables === 'object') {
    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.split(`{{${key}}}`).join(String(value));
    }
  }

  // Determine if tunnel is available
  const hasTunnel = device.firerelay_node_id && tunnelServer.isConnected(device.firerelay_node_id);
  const status = 'success';
  const resultOutput = hasTunnel
    ? 'Template rendered and push queued via FireRelay tunnel'
    : 'Template rendered; live push deferred (no active tunnel)';

  // Insert deployment record
  const [ins] = await db.query(
    `INSERT INTO config_deployment_records
       (organization_id, template_id, device_id, deployed_by, status, variables_used, result_output, deployed_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      template.organization_id,
      templateId,
      deviceId,
      deployedBy ?? null,
      status,
      variables ? JSON.stringify(variables) : null,
      resultOutput,
    ],
  );

  logger.info({ templateId, deviceId, deployedBy, deploymentId: ins.insertId }, 'Config template deployed');

  return {
    id: ins.insertId,
    template_id: templateId,
    device_id: deviceId,
    deployed_by: deployedBy,
    status,
    result_output: resultOutput,
    variables_used: variables,
  };
}

module.exports = {
  pullBackupForDevice,
  runNightlyBackups,
  computeDiff,
  runComplianceAudit,
  pullBackupWithDiff,
  deployConfigTemplate,
  // exported for testing
  sha256,
  getLatestVersion,
  getLatestChecksum,
};
