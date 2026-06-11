// =============================================================================
// FireISP 5.0 — FTTH Service (§7.1/§7.2)
// =============================================================================
// Provides the interface layer between the API routes and the underlying
// OLT/ONU device I/O layer.
//
// IMPLEMENTATION NOTE:
//   Live device I/O (TL1/NETCONF/SSH CLI sessions, OMCI channel delivery)
//   is intentionally stubbed here. Each method records the intent as a
//   job row (onu_firmware_jobs) or config record (onu_omci_configs) and
//   returns a structured result. The background job processor
//   (ftth_onu_firmware_job_processor scheduled task) is responsible for
//   actually dispatching commands to devices.
//
//   To add real vendor drivers, implement:
//     src/services/ftth/drivers/<vendor>Driver.js
//   with the interface: { provision, reboot, upgradeFirmware, getOpticalDiagnostics }
//   and call them from the job processor.
// =============================================================================

'use strict';

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'ftthService' });

// ---------------------------------------------------------------------------
// OLT helpers
// ---------------------------------------------------------------------------

/**
 * Get the list of PON ports for an OLT device, enriched with latest metrics.
 * @param {number} oltDeviceId
 * @param {number|null} orgId
 * @returns {Promise<Array>}
 */
async function getOltPorts(oltDeviceId, orgId) {
  const [rows] = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM onu_details d
             WHERE d.olt_port_id = p.id AND d.deleted_at IS NULL) AS provisioned_onus
     FROM olt_ports p
     WHERE p.olt_device_id = ?
       AND (p.organization_id = ? OR p.organization_id IS NULL)
       AND p.deleted_at IS NULL
     ORDER BY p.slot_no ASC, p.port_no ASC, p.port_index ASC`,
    [oltDeviceId, orgId],
  );
  return rows;
}

/**
 * Get summary chassis status for an OLT: latest SNMP metrics row.
 * @param {number} oltDeviceId
 * @returns {Promise<object|null>}
 */
async function getOltChassisSummary(oltDeviceId) {
  const [rows] = await db.query(
    `SELECT cpu_usage, memory_usage, temperature_c, if_oper_status, polled_at
     FROM snmp_metrics
     WHERE device_id = ?
     ORDER BY polled_at DESC
     LIMIT 1`,
    [oltDeviceId],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// ONU helpers
// ---------------------------------------------------------------------------

/**
 * Get ONUs registered on a given OLT (with detail and profile info).
 * @param {number} oltDeviceId
 * @param {number|null} orgId
 * @param {{ state?: string, portId?: number }} filters
 * @returns {Promise<Array>}
 */
async function getOnusForOlt(oltDeviceId, orgId, filters = {}) {
  let sql = `
    SELECT
      d.id, d.name, d.mac_address, d.ip_address, d.firmware, d.status,
      od.serial_number, od.loid, od.onu_state, od.onu_id, od.ranging_distance_m,
      od.wan_mode, od.line_profile_name, od.service_profile_name, od.last_status_at,
      od.olt_port_id, od.onu_profile_id,
      op.port_name,
      np.name AS onu_profile_name, np.technology AS onu_profile_technology
    FROM onu_details od
    JOIN devices d ON d.id = od.device_id AND d.deleted_at IS NULL
    LEFT JOIN olt_ports op ON op.id = od.olt_port_id
    LEFT JOIN onu_profiles np ON np.id = od.onu_profile_id AND np.deleted_at IS NULL
    WHERE od.olt_device_id = ?
      AND (od.organization_id = ? OR od.organization_id IS NULL)
      AND od.deleted_at IS NULL
  `;
  const params = [oltDeviceId, orgId];

  if (filters.state) {
    sql += ' AND od.onu_state = ?';
    params.push(filters.state);
  }
  if (filters.portId) {
    sql += ' AND od.olt_port_id = ?';
    params.push(filters.portId);
  }

  sql += ' ORDER BY op.port_index ASC, od.onu_id ASC';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get optical diagnostic history for a single ONU.
 * @param {number} onuDeviceId
 * @param {number|null} orgId
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getOnuOpticalHistory(onuDeviceId, orgId, limit = 100) {
  const [rows] = await db.query(
    `SELECT id, tx_power_dbm, rx_power_dbm, temperature_c, voltage_v,
            bias_current_ma, olt_rx_power_dbm, polled_at
     FROM onu_optical_metrics
     WHERE device_id = ?
       AND (organization_id = ? OR organization_id IS NULL)
     ORDER BY polled_at DESC
     LIMIT ?`,
    [onuDeviceId, orgId, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Provisioning (stub — records intent, actual delivery via job processor)
// ---------------------------------------------------------------------------

/**
 * Provision an ONU: write onu_details row and create a provision job.
 * Actual delivery to device is done by the ftth_onu_firmware_job_processor task.
 * @param {object} params
 * @param {number} params.deviceId  — existing device row (type='onu')
 * @param {number} params.oltDeviceId
 * @param {number|null} params.oltPortId
 * @param {number|null} params.onuProfileId
 * @param {string|null} params.serialNumber
 * @param {string|null} params.loid
 * @param {string|null} params.loidPasswordEncrypted
 * @param {number} params.orgId
 * @param {number|null} params.createdBy
 * @returns {Promise<{ detail: object, job: object }>}
 */
async function provisionOnu(params) {
  const {
    deviceId, oltDeviceId, oltPortId, onuProfileId,
    serialNumber, loid, loidPasswordEncrypted,
    orgId, createdBy,
  } = params;

  logger.info({ deviceId, oltDeviceId, serialNumber }, 'ftthService.provisionOnu: recording provision intent');

  // Upsert onu_details
  const [existing] = await db.query(
    'SELECT id FROM onu_details WHERE device_id = ? AND deleted_at IS NULL',
    [deviceId],
  );

  let detailId;
  if (existing.length) {
    await db.query(
      `UPDATE onu_details SET
         olt_device_id = ?, olt_port_id = ?, onu_profile_id = ?,
         serial_number = ?, loid = ?, loid_password_encrypted = ?,
         onu_state = 'unconfigured', updated_at = NOW()
       WHERE id = ?`,
      [oltDeviceId, oltPortId, onuProfileId, serialNumber, loid, loidPasswordEncrypted, existing[0].id],
    );
    detailId = existing[0].id;
  } else {
    const [res] = await db.query(
      `INSERT INTO onu_details
         (organization_id, device_id, olt_device_id, olt_port_id, onu_profile_id,
          serial_number, loid, loid_password_encrypted, onu_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unconfigured')`,
      [orgId, deviceId, oltDeviceId, oltPortId, onuProfileId, serialNumber, loid, loidPasswordEncrypted],
    );
    detailId = res.insertId;
  }

  // Create a provision job (stub — no live dispatch here)
  const [jobRes] = await db.query(
    `INSERT INTO onu_firmware_jobs
       (organization_id, job_type, scope, onu_device_id, olt_device_id, olt_port_id,
        status, total_devices, created_by)
     VALUES (?, 'provision', 'single_onu', ?, ?, ?, 'pending', 1, ?)`,
    [orgId, deviceId, oltDeviceId, oltPortId, createdBy],
  );

  // Link detail to job
  await db.query(
    'UPDATE onu_details SET last_provision_job_id = ? WHERE id = ?',
    [jobRes.insertId, detailId],
  );

  const [[detail]] = await db.query('SELECT * FROM onu_details WHERE id = ?', [detailId]);
  const [[job]] = await db.query('SELECT * FROM onu_firmware_jobs WHERE id = ?', [jobRes.insertId]);

  return { detail, job };
}

/**
 * Schedule an ONU reboot command (recorded as a job, dispatched by processor).
 * @param {number} onuDeviceId
 * @param {number} oltDeviceId
 * @param {number|null} orgId
 * @param {number|null} createdBy
 * @returns {Promise<object>} job row
 */
async function scheduleOnuReboot(onuDeviceId, oltDeviceId, orgId, createdBy) {
  logger.info({ onuDeviceId, oltDeviceId }, 'ftthService.scheduleOnuReboot: recording reboot job');

  const [res] = await db.query(
    `INSERT INTO onu_firmware_jobs
       (organization_id, job_type, scope, onu_device_id, olt_device_id,
        status, total_devices, created_by)
     VALUES (?, 'reboot', 'single_onu', ?, ?, 'pending', 1, ?)`,
    [orgId, onuDeviceId, oltDeviceId, createdBy],
  );
  const [[job]] = await db.query('SELECT * FROM onu_firmware_jobs WHERE id = ?', [res.insertId]);
  return job;
}

/**
 * Schedule a firmware upgrade job (single ONU, OLT port, or full OLT).
 * @param {object} params
 * @returns {Promise<object>} job row
 */
async function scheduleFirmwareUpgrade(params) {
  const {
    scope, onuDeviceId, oltDeviceId, oltPortId,
    firmwareVersion, firmwareUrl, scheduledAt,
    orgId, createdBy,
  } = params;

  logger.info({ scope, oltDeviceId, firmwareVersion }, 'ftthService.scheduleFirmwareUpgrade: recording firmware job');

  const [res] = await db.query(
    `INSERT INTO onu_firmware_jobs
       (organization_id, job_type, scope, onu_device_id, olt_device_id, olt_port_id,
        firmware_version, firmware_url, scheduled_at, status, total_devices, created_by)
     VALUES (?, 'firmware_upgrade', ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [orgId, scope, onuDeviceId, oltDeviceId, oltPortId, firmwareVersion, firmwareUrl, scheduledAt, createdBy],
  );
  const [[job]] = await db.query('SELECT * FROM onu_firmware_jobs WHERE id = ?', [res.insertId]);
  return job;
}

// ---------------------------------------------------------------------------
// §7.3 PON Port Management
// ---------------------------------------------------------------------------

/**
 * Get utilization summary for a single PON port (ONU count, optical power
 * spread, bandwidth utilization) by joining olt_ports + onu_optical_metrics.
 * @param {number} portId
 * @param {number|null} orgId
 * @returns {Promise<object>}
 */
async function getPortUtilization(portId, orgId) {
  // Port base row
  const [[port]] = await db.query(
    `SELECT p.*, d.name AS olt_name
     FROM olt_ports p
     LEFT JOIN devices d ON d.id = p.olt_device_id
     WHERE p.id = ?
       AND (p.organization_id = ? OR p.organization_id IS NULL)
       AND p.deleted_at IS NULL`,
    [portId, orgId],
  );
  if (!port) return null;

  // Active/inactive ONU breakdown
  const [onuCounts] = await db.query(
    `SELECT onu_state, COUNT(*) AS cnt
     FROM onu_details
     WHERE olt_port_id = ? AND deleted_at IS NULL
     GROUP BY onu_state`,
    [portId],
  );

  // Latest optical metrics summary (avg/min/max from last 100 rows)
  const [opticalSummary] = await db.query(
    `SELECT
       AVG(rx_power_dbm) AS avg_rx_dbm,
       MIN(rx_power_dbm) AS min_rx_dbm,
       MAX(rx_power_dbm) AS max_rx_dbm,
       AVG(tx_power_dbm) AS avg_tx_dbm
     FROM (
       SELECT rx_power_dbm, tx_power_dbm
       FROM onu_optical_metrics
       WHERE olt_port_id = ?
       ORDER BY polled_at DESC
       LIMIT 100
     ) latest`,
    [portId],
  );

  return {
    port,
    onu_state_counts: onuCounts,
    optical_summary: opticalSummary[0] || null,
  };
}

/**
 * List active/inactive ONUs on a given PON port.
 * @param {number} portId
 * @param {number|null} orgId
 * @param {string|null} state  filter by onu_state
 * @returns {Promise<Array>}
 */
async function getOnusForPort(portId, orgId, state = null) {
  let sql = `
    SELECT
      d.id, d.name, d.mac_address, d.ip_address, d.status,
      od.serial_number, od.onu_state, od.onu_id, od.ranging_distance_m,
      od.last_status_at, od.wan_mode
    FROM onu_details od
    JOIN devices d ON d.id = od.device_id AND d.deleted_at IS NULL
    WHERE od.olt_port_id = ?
      AND (od.organization_id = ? OR od.organization_id IS NULL)
      AND od.deleted_at IS NULL
  `;
  const params = [portId, orgId];
  if (state) { sql += ' AND od.onu_state = ?'; params.push(state); }
  sql += ' ORDER BY od.onu_id ASC, d.name ASC';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Calculate optical power budget for a PON link.
 * Pure calculation — no DB I/O.
 *
 * Formula:
 *   budget = olt_tx_power_dbm - (splitter_loss_db + fiber_attenuation_db + connector_margin_db)
 *   where fiber_attenuation_db = fiber_length_m / 1000 * attenuation_per_km_db
 *
 * @param {object} params
 * @param {number} params.oltTxPowerDbm        OLT transmit power (e.g. +3.0 dBm)
 * @param {string} params.splitterRatio        '1:32', '1:64', etc.
 * @param {number} params.fiberLengthM         Total fiber path length in metres
 * @param {number} [params.attenuationPerKmDb] Fiber attenuation (default 0.35 dB/km for G.652)
 * @param {number} [params.connectorMarginDb]  Additional connector/splice loss margin (default 2.0)
 * @returns {{ budget_db: number, splitter_loss_db: number, fiber_loss_db: number, margin_db: number, result: string }}
 */
function calculatePowerBudget({
  oltTxPowerDbm,
  splitterRatio,
  fiberLengthM,
  attenuationPerKmDb = 0.35,
  connectorMarginDb = 2.0,
}) {
  // Splitter insertion loss by ratio
  const SPLITTER_LOSS = {
    '1:2': 3.8, '1:4': 7.4, '1:8': 10.9, '1:16': 13.9,
    '1:32': 17.0, '1:64': 20.0, '1:128': 23.5,
  };
  const splitterLoss = SPLITTER_LOSS[splitterRatio] || SPLITTER_LOSS['1:32'];
  const fiberLoss = (fiberLengthM / 1000) * attenuationPerKmDb;
  const totalLoss = splitterLoss + fiberLoss + connectorMarginDb;
  const budgetDb = oltTxPowerDbm - totalLoss;

  // GPON class B+ max path loss = 28 dB
  const MAX_PATH_LOSS_DB = 28;
  const result = totalLoss <= MAX_PATH_LOSS_DB ? 'ok' : 'exceeded';

  return {
    budget_db: Number(budgetDb.toFixed(2)),
    splitter_loss_db: Number(splitterLoss.toFixed(2)),
    fiber_loss_db: Number(fiberLoss.toFixed(2)),
    total_loss_db: Number(totalLoss.toFixed(2)),
    max_path_loss_db: MAX_PATH_LOSS_DB,
    margin_db: Number((MAX_PATH_LOSS_DB - totalLoss).toFixed(2)),
    result,
  };
}

/**
 * Set or clear maintenance mode on a PON port.
 * Creates a job record stub for the actual admin_status change on device.
 * @param {number} portId
 * @param {boolean} enable        true = enable maintenance, false = clear
 * @param {string|null} note
 * @param {number|null} userId
 * @param {number|null} orgId
 * @returns {Promise<object>} updated port row
 */
async function setPortMaintenanceMode(portId, enable, note, userId, orgId) {
  logger.info({ portId, enable, userId }, 'ftthService.setPortMaintenanceMode');

  const [check] = await db.query(
    'SELECT id FROM olt_ports WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [portId, orgId],
  );
  if (!check.length) throw Object.assign(new Error('OLT port not found'), { statusCode: 404 });

  await db.query(
    `UPDATE olt_ports SET
       maintenance_mode = ?,
       maintenance_note = ?,
       maintenance_by   = ?,
       maintenance_at   = ?,
       updated_at       = NOW()
     WHERE id = ?`,
    [enable ? 1 : 0, enable ? (note || null) : null, enable ? userId : null, enable ? new Date() : null, portId],
  );

  const [[port]] = await db.query('SELECT * FROM olt_ports WHERE id = ?', [portId]);
  return port;
}

/**
 * Configure XGS-PON mode on a PON port.
 * Validates the requested mode against olt_vendor_capabilities.protocols.
 * Records intent; actual device command is stubbed via a firmware_job-style record.
 * @param {number} portId
 * @param {string} mode  one of: gpon, xgspon_2_5g, xgspon_10g, auto, none
 * @param {number|null} orgId
 * @returns {Promise<object>} updated port row
 */
async function configurePortXgsPonMode(portId, mode, orgId) {
  logger.info({ portId, mode }, 'ftthService.configurePortXgsPonMode');

  const VALID_MODES = ['gpon', 'xgspon_2_5g', 'xgspon_10g', 'auto', 'none'];
  if (!VALID_MODES.includes(mode)) {
    throw Object.assign(new Error(`Invalid XGS-PON mode: ${mode}`), { statusCode: 400 });
  }

  const [[port]] = await db.query(
    `SELECT p.*, d.manufacturer, d.model
     FROM olt_ports p
     LEFT JOIN devices d ON d.id = p.olt_device_id
     WHERE p.id = ?
       AND (p.organization_id = ? OR p.organization_id IS NULL)
       AND p.deleted_at IS NULL`,
    [portId, orgId],
  );
  if (!port) throw Object.assign(new Error('OLT port not found'), { statusCode: 404 });

  // Validate against vendor capabilities if port is an xgspon port type
  let validated = 0;
  if (port.port_type === 'xgspon' || mode !== 'none') {
    const [caps] = await db.query(
      'SELECT protocols FROM olt_vendor_capabilities WHERE vendor = ? AND ? LIKE model_pattern ORDER BY id LIMIT 1',
      [port.manufacturer || '', port.model || ''],
    );
    if (caps.length) {
      const protocols = typeof caps[0].protocols === 'string'
        ? JSON.parse(caps[0].protocols) : (caps[0].protocols || []);
      const supportsXgs = protocols.includes('snmp') || protocols.includes('netconf');
      validated = supportsXgs ? 1 : 0;
    }
  }

  await db.query(
    'UPDATE olt_ports SET xgspon_mode = ?, xgspon_mode_validated = ?, updated_at = NOW() WHERE id = ?',
    [mode, validated, portId],
  );

  const [[updated]] = await db.query('SELECT * FROM olt_ports WHERE id = ?', [portId]);
  return updated;
}

/**
 * Create an ONU migration job (transactional port reassignment intent).
 * Actual de-registration + re-registration on device is stubbed.
 * @param {object} params
 * @returns {Promise<object>} created job row
 */
async function createOnuMigrationJob(params) {
  const {
    onuDeviceId, sourceOltPortId, targetOltPortId,
    sourceOltDeviceId, targetOltDeviceId, scheduledAt, orgId, createdBy, notes,
  } = params;

  logger.info({ onuDeviceId, sourceOltPortId, targetOltPortId }, 'ftthService.createOnuMigrationJob: recording migration intent');

  // Validate source port != target port
  if (sourceOltPortId === targetOltPortId) {
    throw Object.assign(new Error('Source and target ports must differ'), { statusCode: 400 });
  }

  // Check ONU is actually on the source port
  const [detail] = await db.query(
    'SELECT id, olt_port_id FROM onu_details WHERE device_id = ? AND deleted_at IS NULL LIMIT 1',
    [onuDeviceId],
  );
  if (!detail.length) {
    throw Object.assign(new Error('ONU detail record not found'), { statusCode: 404 });
  }

  const [res] = await db.query(
    `INSERT INTO onu_migration_jobs
       (organization_id, onu_device_id, source_olt_port_id, target_olt_port_id,
        source_olt_device_id, target_olt_device_id, scheduled_at, status, created_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [orgId, onuDeviceId, sourceOltPortId, targetOltPortId,
      sourceOltDeviceId || null, targetOltDeviceId || null,
      scheduledAt || null, createdBy, notes || null],
  );

  const [[job]] = await db.query('SELECT * FROM onu_migration_jobs WHERE id = ?', [res.insertId]);
  return job;
}

module.exports = {
  getOltPorts,
  getOltChassisSummary,
  getOnusForOlt,
  getOnuOpticalHistory,
  provisionOnu,
  scheduleOnuReboot,
  scheduleFirmwareUpgrade,
  // §7.3
  getPortUtilization,
  getOnusForPort,
  calculatePowerBudget,
  setPortMaintenanceMode,
  configurePortXgsPonMode,
  createOnuMigrationJob,
};
