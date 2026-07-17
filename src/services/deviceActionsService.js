// =============================================================================
// FireISP 5.0 — Device Actions Service
// =============================================================================
// Operator actions against network devices in the `devices` table. Today:
// rebootDevice — routes a reboot to whatever real mechanism the device has,
// and refuses honestly when none exists (never a silent fake-success).
//
// Reboot paths, in order:
//   1. ONU (type 'onu')          → ftthService.scheduleOnuReboot (queued job)
//   2. MikroTik driver config     → routerDriverService.dispatchCommand('reboot')
//   3. anything else              → ValidationError('reboot not supported')
// =============================================================================

const db = require('../config/database');
const { NotFoundError, ValidationError } = require('../utils/errors');
const ftthService = require('./ftthService');
const routerDriverService = require('./routerDriverService');
const logger = require('../utils/logger').child({ service: 'deviceActions' });

/**
 * Reboot a device via the real mechanism its type/driver supports.
 *
 * @param {number} deviceId
 * @param {number} orgId
 * @param {number|null} userId
 * @returns {Promise<{ method: string, status: string, detail: object }>}
 * @throws {NotFoundError} device not found in the caller's org
 * @throws {ValidationError} device type has no supported reboot mechanism
 */
async function rebootDevice(deviceId, orgId, userId = null) {
  const [rows] = await db.query(
    `SELECT id, name, type, status
       FROM devices
      WHERE id = ?
        AND (organization_id = ? OR site_id IN (SELECT id FROM sites WHERE organization_id = ?))
        AND deleted_at IS NULL
      LIMIT 1`,
    [deviceId, orgId, orgId],
  );
  if (!rows.length) throw new NotFoundError('Device not found');
  const device = rows[0];

  // 1. ONU — delegate to the FTTH reboot-job path (needs its OLT parent).
  if (device.type === 'onu') {
    const [onu] = await db.query(
      `SELECT device_id, olt_device_id FROM onu_details
        WHERE device_id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL
        LIMIT 1`,
      [deviceId, orgId],
    );
    if (!onu.length) {
      throw new ValidationError('ONU has no onu_details record — cannot resolve its OLT to reboot');
    }
    const job = await ftthService.scheduleOnuReboot(onu[0].device_id, onu[0].olt_device_id, orgId, userId);
    logger.info({ deviceId, jobId: job.id }, 'Device reboot queued via ONU job');
    return { method: 'onu_job', status: 'queued', detail: { job_id: job.id } };
  }

  // 2. Devices with a MikroTik driver config — dispatch a real reboot command.
  const [configs] = await db.query(
    `SELECT id FROM router_driver_configs
      WHERE device_id = ? AND organization_id = ? AND vendor = 'mikrotik'
        AND is_active = 1 AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [deviceId, orgId],
  );
  if (configs.length) {
    const result = await routerDriverService.dispatchCommand(configs[0].id, orgId, 'reboot', {}, userId);
    if (!result || result.status !== 'success') {
      // dispatchCommand records failures without throwing; surface them.
      throw new ValidationError(result?.error_message || 'Reboot command failed on the device');
    }
    logger.info({ deviceId, executionId: result.execution_id }, 'Device reboot dispatched via MikroTik driver');
    return { method: 'mikrotik_driver', status: 'issued', detail: { execution_id: result.execution_id } };
  }

  // 3. No supported mechanism — refuse honestly rather than fake success.
  throw new ValidationError(
    `Reboot is not supported for device type '${device.type}' without a MikroTik driver config`,
  );
}

module.exports = { rebootDevice };
