// =============================================================================
// FireISP 5.0 — Device Online/Offline State Machine
// =============================================================================
// Detects device up/down transitions from SNMP poll results and emits
// device.offline/device.online for the notification pipeline
// (notificationHooks.js). Neither snmpPoller.js nor pollerEngine.js ever
// wrote devices.status before this — it sat frozen at its schema default
// ('offline') forever, so nothing downstream that reads it (dashboards,
// alertService's device-scoped checks) ever reflected reality.
//
// Thresholds:
//   - >= 3 consecutive failed polls flips a device to 'offline' (unless it is
//     already 'offline' or 'maintenance' — 'maintenance' is never auto-flipped
//     either direction).
//   - The next successful poll after a detector-driven 'offline' resets the
//     failure counter and flips back to 'online', emitting device.online.
//   - Every device defaults to status='offline' from creation (schema
//     default), so a device that has simply never been polled yet is
//     'offline' with consecutive_poll_failures=0 — NOT a real detected
//     outage. Its first successful poll still flips the column to 'online'
//     (so the status ever reflects reality at all) but emits NOTHING — this
//     is the guard against a "every device in the fleet just came online"
//     notification stampede the moment polling starts for the first time
//     (e.g. right after this feature's first deploy).
// =============================================================================

const db = require('../config/database');
const eventBus = require('./eventBus');
const logger = require('../utils/logger').child({ service: 'deviceStatusService' });

const OFFLINE_THRESHOLD = 3;

/**
 * Record the result of one poll attempt for a device and run the up/down
 * state machine. Call this from a polling path right after success/failure is
 * already known — it folds the state-machine write into the SAME UPDATE that
 * already carries last_polled_at/last_poll_error, so callers gain the status
 * tracking with no extra round trip beyond the one SELECT needed to read the
 * device's current status/failure count.
 *
 * @param {number} deviceId
 * @param {boolean} success
 * @param {string|null} [errorMessage] - only meaningful when success is false
 */
async function recordPollResult(deviceId, success, errorMessage = null) {
  const [[device]] = await db.query(
    `SELECT id, organization_id, name, ip_address, type, status, consecutive_poll_failures
     FROM devices WHERE id = ? AND deleted_at IS NULL`,
    [deviceId],
  );
  if (!device) return;

  if (success) {
    const wasOffline = device.status === 'offline';
    // Only a REAL detected outage recovering is worth notifying about — a
    // device that was merely at its never-polled default (0 failures) going
    // 'online' for the first time is not.
    const isDetectorRecovery = wasOffline && device.consecutive_poll_failures >= OFFLINE_THRESHOLD;
    const newStatus = wasOffline ? 'online' : device.status;

    await db.query(
      `UPDATE devices
       SET last_polled_at = NOW(), last_poll_error = NULL, consecutive_poll_failures = 0, status = ?
       WHERE id = ?`,
      [newStatus, deviceId],
    );

    if (isDetectorRecovery) {
      eventBus.emit('device.online', {
        organizationId: device.organization_id,
        device: { ...device, status: 'online', consecutive_poll_failures: 0 },
      }).catch(err => logger.warn({ err: err.message, deviceId }, 'device.online emit failed'));
    }
    return;
  }

  // Failure path
  const newFailureCount = (device.consecutive_poll_failures || 0) + 1;
  const shouldFlipOffline = newFailureCount >= OFFLINE_THRESHOLD
    && device.status !== 'offline'
    && device.status !== 'maintenance';
  const newStatus = shouldFlipOffline ? 'offline' : device.status;

  await db.query(
    `UPDATE devices
     SET last_poll_error = ?, consecutive_poll_failures = ?, status = ?
     WHERE id = ?`,
    [errorMessage, newFailureCount, newStatus, deviceId],
  );

  if (shouldFlipOffline) {
    eventBus.emit('device.offline', {
      organizationId: device.organization_id,
      device: { ...device, status: 'offline', consecutive_poll_failures: newFailureCount },
    }).catch(err => logger.warn({ err: err.message, deviceId }, 'device.offline emit failed'));
  }
}

module.exports = { recordPollResult, OFFLINE_THRESHOLD };
