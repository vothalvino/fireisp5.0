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

module.exports = {
  getOltPorts,
  getOltChassisSummary,
  getOnusForOlt,
  getOnuOpticalHistory,
  provisionOnu,
  scheduleOnuReboot,
  scheduleFirmwareUpgrade,
};
