'use strict';

// =============================================================================
// FireISP 5.0 — Wireless/WISP Management Service (§9.1)
// =============================================================================
// Provides domain logic for:
//   • AP sector configuration management
//   • Channel plan management and conflict detection
//   • Wireless client session snapshots
//   • Channel interference detection and recording
//   • AP remote command job management
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'wirelessService' });

// ---------------------------------------------------------------------------
// AP Sector Configs
// ---------------------------------------------------------------------------

/**
 * List all AP sector configs for an org (with optional device filter).
 */
async function listApSectorConfigs(orgId, { deviceId, deletedAt } = {}) {
  let sql = `
    SELECT asc_cfg.*, d.hostname AS device_hostname, d.type AS device_type,
           d.ip_address AS device_ip,
           acp.name AS channel_plan_name, acp.frequency_mhz AS plan_frequency_mhz
    FROM ap_sector_configs asc_cfg
    LEFT JOIN devices d ON d.id = asc_cfg.device_id
    LEFT JOIN ap_channel_plans acp ON acp.id = asc_cfg.channel_plan_id
    WHERE (asc_cfg.organization_id = ? OR asc_cfg.organization_id IS NULL)
  `;
  const params = [orgId];

  if (deviceId) {
    sql += ' AND asc_cfg.device_id = ?';
    params.push(deviceId);
  }
  if (!deletedAt) {
    sql += ' AND asc_cfg.deleted_at IS NULL';
  }
  sql += ' ORDER BY asc_cfg.id ASC';

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get a single AP sector config by ID.
 */
async function getApSectorConfig(id, orgId) {
  const [rows] = await db.query(
    `SELECT asc_cfg.*, d.hostname AS device_hostname, d.type AS device_type,
            d.ip_address AS device_ip,
            acp.name AS channel_plan_name
     FROM ap_sector_configs asc_cfg
     LEFT JOIN devices d ON d.id = asc_cfg.device_id
     LEFT JOIN ap_channel_plans acp ON acp.id = asc_cfg.channel_plan_id
     WHERE asc_cfg.id = ?
       AND (asc_cfg.organization_id = ? OR asc_cfg.organization_id IS NULL)
       AND asc_cfg.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Create an AP sector config.
 * Validates that the device exists and is of type ptmp_ap or ptp.
 */
async function createApSectorConfig(orgId, data) {
  const { device_id } = data;

  // Validate device type
  const [devRows] = await db.query(
    `SELECT id, type FROM devices
     WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL`,
    [device_id, orgId],
  );
  if (!devRows.length) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['ptmp_ap', 'ptp', 'outdoor_cpe', 'indoor_cpe'].includes(devRows[0].type)) {
    const err = new Error('Device must be of type ptmp_ap, ptp, outdoor_cpe, or indoor_cpe');
    err.statusCode = 400;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO ap_sector_configs SET ?',
    [{ organization_id: orgId, ...fields }],
  );
  return getApSectorConfig(result.insertId, orgId);
}

/**
 * Update an AP sector config.
 */
async function updateApSectorConfig(id, orgId, data) {
  const existing = await getApSectorConfig(id, orgId);
  if (!existing) {
    const err = new Error('AP sector config not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = data;
  await db.query(
    'UPDATE ap_sector_configs SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [{ ...fields, updated_at: new Date() }, id, orgId],
  );
  return getApSectorConfig(id, orgId);
}

/**
 * Soft-delete an AP sector config.
 */
async function deleteApSectorConfig(id, orgId) {
  const existing = await getApSectorConfig(id, orgId);
  if (!existing) {
    const err = new Error('AP sector config not found');
    err.statusCode = 404;
    throw err;
  }
  await db.query(
    'UPDATE ap_sector_configs SET deleted_at = NOW() WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
}

/**
 * Restore a soft-deleted AP sector config.
 */
async function restoreApSectorConfig(id, orgId) {
  await db.query(
    'UPDATE ap_sector_configs SET deleted_at = NULL WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
  return getApSectorConfig(id, orgId);
}

// ---------------------------------------------------------------------------
// AP Channel Plans
// ---------------------------------------------------------------------------

/**
 * List all AP channel plans for an org.
 */
async function listApChannelPlans(orgId, { siteId, status } = {}) {
  let sql = `
    SELECT acp.*, s.name AS site_name
    FROM ap_channel_plans acp
    LEFT JOIN sites s ON s.id = acp.site_id
    WHERE (acp.organization_id = ? OR acp.organization_id IS NULL)
      AND acp.deleted_at IS NULL
  `;
  const params = [orgId];

  if (siteId) {
    sql += ' AND acp.site_id = ?';
    params.push(siteId);
  }
  if (status) {
    sql += ' AND acp.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY acp.site_id ASC, acp.frequency_mhz ASC';

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get a single AP channel plan by ID.
 */
async function getApChannelPlan(id, orgId) {
  const [rows] = await db.query(
    `SELECT acp.*, s.name AS site_name
     FROM ap_channel_plans acp
     LEFT JOIN sites s ON s.id = acp.site_id
     WHERE acp.id = ?
       AND (acp.organization_id = ? OR acp.organization_id IS NULL)
       AND acp.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Create an AP channel plan.
 */
async function createApChannelPlan(orgId, data) {
  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO ap_channel_plans SET ?',
    [{ organization_id: orgId, ...fields }],
  );
  return getApChannelPlan(result.insertId, orgId);
}

/**
 * Update an AP channel plan.
 */
async function updateApChannelPlan(id, orgId, data) {
  const existing = await getApChannelPlan(id, orgId);
  if (!existing) {
    const err = new Error('AP channel plan not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = data;
  await db.query(
    'UPDATE ap_channel_plans SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [{ ...fields, updated_at: new Date() }, id, orgId],
  );
  return getApChannelPlan(id, orgId);
}

/**
 * Soft-delete an AP channel plan.
 */
async function deleteApChannelPlan(id, orgId) {
  const existing = await getApChannelPlan(id, orgId);
  if (!existing) {
    const err = new Error('AP channel plan not found');
    err.statusCode = 404;
    throw err;
  }
  await db.query(
    'UPDATE ap_channel_plans SET deleted_at = NOW() WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
}

/**
 * Restore a soft-deleted AP channel plan.
 */
async function restoreApChannelPlan(id, orgId) {
  await db.query(
    'UPDATE ap_channel_plans SET deleted_at = NULL WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
  return getApChannelPlan(id, orgId);
}

/**
 * Detect potential channel conflicts within a site.
 * Returns pairs of channel plans that overlap in frequency.
 */
async function detectChannelConflicts(siteId, orgId) {
  const [rows] = await db.query(
    `SELECT a.id AS plan_a_id, a.name AS plan_a_name,
            a.frequency_mhz AS freq_a, a.channel_width_mhz AS width_a,
            b.id AS plan_b_id, b.name AS plan_b_name,
            b.frequency_mhz AS freq_b, b.channel_width_mhz AS width_b
     FROM ap_channel_plans a
     JOIN ap_channel_plans b ON b.id > a.id AND b.site_id = a.site_id
     WHERE a.site_id = ?
       AND (a.organization_id = ? OR a.organization_id IS NULL)
       AND a.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND a.status = 'active'
       AND b.status = 'active'
       AND ABS(a.frequency_mhz - b.frequency_mhz) < (a.channel_width_mhz + b.channel_width_mhz) / 2`,
    [siteId, orgId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Wireless Client Sessions
// ---------------------------------------------------------------------------

/**
 * List wireless client sessions for an AP device.
 */
async function listWirelessClientSessions(orgId, { deviceId, since, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT wcs.*, d.hostname AS ap_hostname,
           cd.hostname AS client_hostname, cd.ip_address AS client_device_ip
    FROM wireless_client_sessions wcs
    LEFT JOIN devices d ON d.id = wcs.device_id
    LEFT JOIN devices cd ON cd.id = wcs.client_device_id
    WHERE (wcs.organization_id = ? OR wcs.organization_id IS NULL)
  `;
  const params = [orgId];

  if (deviceId) {
    sql += ' AND wcs.device_id = ?';
    params.push(deviceId);
  }
  if (since) {
    sql += ' AND wcs.last_seen_at >= ?';
    params.push(since);
  }
  sql += ' ORDER BY wcs.last_seen_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Record a batch of wireless client session snapshots from an AP poll.
 * Accepts an array of session objects; each must have device_id and mac_address.
 */
async function recordClientSessions(orgId, sessions) {
  if (!sessions || !sessions.length) return 0;

  const rows = sessions.map(s => [
    orgId,
    s.device_id,
    s.client_device_id || null,
    s.mac_address,
    s.ip_address || null,
    s.signal_dbm || null,
    s.noise_floor_dbm || null,
    s.snr_db || null,
    s.ccq_pct || null,
    s.tx_rate_mbps || null,
    s.rx_rate_mbps || null,
    s.distance_m || null,
    s.connected_at || null,
    s.last_seen_at || new Date(),
  ]);

  const [result] = await db.query(
    `INSERT INTO wireless_client_sessions
       (organization_id, device_id, client_device_id, mac_address, ip_address,
        signal_dbm, noise_floor_dbm, snr_db, ccq_pct, tx_rate_mbps, rx_rate_mbps,
        distance_m, connected_at, last_seen_at)
     VALUES ?`,
    [rows],
  );
  logger.debug({ orgId, count: result.affectedRows }, 'wireless client sessions recorded');
  return result.affectedRows;
}

// ---------------------------------------------------------------------------
// Channel Interference
// ---------------------------------------------------------------------------

/**
 * List channel interference records for an org.
 */
async function listChannelInterference(orgId, { siteId, level, since, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT wci.*, s.name AS site_name,
           asc_cfg.sector_azimuth_deg, asc_cfg.frequency_mhz AS sector_frequency_mhz
    FROM wireless_channel_interference wci
    LEFT JOIN sites s ON s.id = wci.site_id
    LEFT JOIN ap_sector_configs asc_cfg ON asc_cfg.id = wci.ap_sector_config_id
    WHERE (wci.organization_id = ? OR wci.organization_id IS NULL)
      AND wci.deleted_at IS NULL
  `;
  const params = [orgId];

  if (siteId) {
    sql += ' AND wci.site_id = ?';
    params.push(siteId);
  }
  if (level) {
    sql += ' AND wci.interference_level = ?';
    params.push(level);
  }
  if (since) {
    sql += ' AND wci.detected_at >= ?';
    params.push(since);
  }
  sql += ' ORDER BY wci.detected_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Create a channel interference record.
 */
async function createChannelInterference(orgId, data) {
  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO wireless_channel_interference SET ?',
    [{ organization_id: orgId, ...fields }],
  );
  const [rows] = await db.query('SELECT * FROM wireless_channel_interference WHERE id = ?', [result.insertId]);
  return rows[0];
}

/**
 * Update a channel interference record.
 */
async function updateChannelInterference(id, orgId, data) {
  const [existing] = await db.query(
    'SELECT id FROM wireless_channel_interference WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [id, orgId],
  );
  if (!existing.length) {
    const err = new Error('Channel interference record not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = data;
  await db.query(
    'UPDATE wireless_channel_interference SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [{ ...fields, updated_at: new Date() }, id, orgId],
  );
  const [rows] = await db.query('SELECT * FROM wireless_channel_interference WHERE id = ?', [id]);
  return rows[0];
}

/**
 * Soft-delete a channel interference record.
 */
async function deleteChannelInterference(id, orgId) {
  await db.query(
    'UPDATE wireless_channel_interference SET deleted_at = NOW() WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
}

// ---------------------------------------------------------------------------
// AP Command Jobs
// ---------------------------------------------------------------------------

/**
 * List AP command jobs for an org.
 */
async function listApCommandJobs(orgId, { deviceId, status, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT acj.*, d.hostname AS device_hostname, d.ip_address AS device_ip
    FROM ap_command_jobs acj
    LEFT JOIN devices d ON d.id = acj.device_id
    WHERE (acj.organization_id = ? OR acj.organization_id IS NULL)
      AND acj.deleted_at IS NULL
  `;
  const params = [orgId];

  if (deviceId) {
    sql += ' AND acj.device_id = ?';
    params.push(deviceId);
  }
  if (status) {
    sql += ' AND acj.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY acj.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get a single AP command job by ID.
 */
async function getApCommandJob(id, orgId) {
  const [rows] = await db.query(
    `SELECT acj.*, d.hostname AS device_hostname
     FROM ap_command_jobs acj
     LEFT JOIN devices d ON d.id = acj.device_id
     WHERE acj.id = ?
       AND (acj.organization_id = ? OR acj.organization_id IS NULL)
       AND acj.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Create an AP command job.
 */
async function createApCommandJob(orgId, userId, data) {
  const { device_id } = data;

  // Verify device belongs to org
  const [devRows] = await db.query(
    'SELECT id FROM devices WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [device_id, orgId],
  );
  if (!devRows.length) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO ap_command_jobs SET ?',
    [{ organization_id: orgId, created_by: userId || null, status: 'pending', ...fields }],
  );
  return getApCommandJob(result.insertId, orgId);
}

/**
 * Cancel an AP command job (only if pending or queued).
 */
async function cancelApCommandJob(id, orgId) {
  const existing = await getApCommandJob(id, orgId);
  if (!existing) {
    const err = new Error('AP command job not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['pending', 'queued'].includes(existing.status)) {
    const err = new Error('Only pending or queued jobs can be cancelled');
    err.statusCode = 409;
    throw err;
  }
  await db.query(
    'UPDATE ap_command_jobs SET status = ?, updated_at = NOW() WHERE id = ?',
    ['cancelled', id],
  );
  return getApCommandJob(id, orgId);
}

module.exports = {
  // AP sector configs
  listApSectorConfigs,
  getApSectorConfig,
  createApSectorConfig,
  updateApSectorConfig,
  deleteApSectorConfig,
  restoreApSectorConfig,
  // AP channel plans
  listApChannelPlans,
  getApChannelPlan,
  createApChannelPlan,
  updateApChannelPlan,
  deleteApChannelPlan,
  restoreApChannelPlan,
  detectChannelConflicts,
  // Wireless client sessions
  listWirelessClientSessions,
  recordClientSessions,
  // Channel interference
  listChannelInterference,
  createChannelInterference,
  updateChannelInterference,
  deleteChannelInterference,
  // AP command jobs
  listApCommandJobs,
  getApCommandJob,
  createApCommandJob,
  cancelApCommandJob,
};
