// =============================================================================
// FireISP 5.0 — CPE Session Log Service (§8.3)
// =============================================================================
// Writes to cpe_session_logs for protocol events and errors.
// Called from acsService on: auth_failure, parse_error, fault, session_error.
// =============================================================================

'use strict';

const db = require('../config/database');

const MAX_EXCERPT = 2000;

/**
 * Record a CWMP session event.
 * @param {object} opts
 * @param {number|null} opts.orgId
 * @param {number|null} opts.cpeDeviceId
 * @param {string} opts.eventType - one of the cpe_session_logs.event_type ENUM values
 * @param {string} [opts.messageType]
 * @param {string} [opts.taskType]
 * @param {string} [opts.faultCode]
 * @param {string} [opts.faultString]
 * @param {string} [opts.remoteIp]
 * @param {string} [opts.rawBody] - raw SOAP XML (truncated to MAX_EXCERPT)
 */
async function logSessionEvent(opts) {
  const {
    orgId = null,
    cpeDeviceId = null,
    eventType,
    messageType = null,
    taskType = null,
    faultCode = null,
    faultString = null,
    remoteIp = null,
    rawBody = null,
  } = opts;

  const rawExcerpt = rawBody
    ? String(rawBody).slice(0, MAX_EXCERPT)
    : null;

  try {
    await db.query(
      `INSERT INTO cpe_session_logs
         (organization_id, cpe_device_id, event_type, message_type, task_type,
          fault_code, fault_string, remote_ip, raw_excerpt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orgId, cpeDeviceId, eventType, messageType, taskType,
        faultCode, faultString ? String(faultString).slice(0, 500) : null,
        remoteIp, rawExcerpt],
    );
  } catch (_err) {
    // Log write must not throw — errors here would break the CWMP session
  }
}

/**
 * Retrieve paginated session logs for a device (or org-wide if cpeDeviceId is null).
 */
async function getSessionLogs({ cpeDeviceId = null, orgId = null, eventType = null, page = 1, limit = 50 }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (orgId) { conditions.push('organization_id = ?'); params.push(orgId); }
  if (cpeDeviceId) { conditions.push('cpe_device_id = ?'); params.push(cpeDeviceId); }
  if (eventType) { conditions.push('event_type = ?'); params.push(eventType); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await db.query(
    `SELECT * FROM cpe_session_logs ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM cpe_session_logs ${where}`,
    params,
  );
  return { data: rows, meta: { total, page, limit } };
}

/**
 * Delete old session log entries (called by scheduled cleanup task).
 * @param {number} [daysOld=90]
 */
async function cleanupOldLogs(daysOld = 90) {
  // Batched: the seeded cleanup task was dead until taskRunner wired it, so
  // the first run can face the table's entire >90-day backlog — one unbounded
  // DELETE would hold row locks and grow the undo log for the whole sweep.
  // Same batching as taskRunner's runFtthOpticalMetricsCleanup.
  const BATCH_SIZE = 10000;
  let totalDeleted = 0;
  let batchDeleted;

  do {
    const [result] = await db.query(
      `DELETE FROM cpe_session_logs
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
       LIMIT ${BATCH_SIZE}`,
      [daysOld],
    );
    batchDeleted = result.affectedRows || 0;
    totalDeleted += batchDeleted;
  } while (batchDeleted === BATCH_SIZE);

  return totalDeleted;
}

/**
 * Delete logs for a specific device (or all under org by orgId only).
 */
async function deleteLogs({ cpeDeviceId = null, orgId = null }) {
  const conditions = [];
  const params = [];
  if (orgId) { conditions.push('organization_id = ?'); params.push(orgId); }
  if (cpeDeviceId) { conditions.push('cpe_device_id = ?'); params.push(cpeDeviceId); }
  if (!conditions.length) return 0;
  const [result] = await db.query(
    `DELETE FROM cpe_session_logs WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return result.affectedRows || 0;
}

module.exports = { logSessionEvent, getSessionLogs, cleanupOldLogs, deleteLogs };
