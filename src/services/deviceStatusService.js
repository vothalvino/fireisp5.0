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
//
// Concurrency: recordPollResult() is reachable from MORE than one scheduled
// task hitting the SAME device around the same time — snmp_discovery_poll
// (migration 254) and ftth_olt_chassis_poll (migration 269) are both `*/5`
// cron and both dispatch through snmpPoller.poll() over the same device set,
// each under its own per-task-name lock, so two concurrent calls for one
// device are routine, not a rare edge case. A naive "SELECT current state,
// decide in JS, then UPDATE" is a classic read-then-write race: two
// concurrent callers can both read the same pre-increment counter and both
// decide to flip + emit (duplicate bell/email), or a lost increment can
// silently reset flap detection. Every write below is instead an atomic
// conditional `UPDATE ... WHERE <guard>` — MySQL's row-level locking
// serializes concurrent UPDATEs to the same row, and `col = col + 1` is
// always evaluated against the row's current (locked, up to date) value, so
// increments are never lost. The emit decision is `affectedRows === 1` on
// the specific guarded flip statement: only the ONE caller whose UPDATE
// actually changed the row (matched its WHERE AND produced a different
// value) gets to emit — a losing concurrent caller's identical WHERE clause
// sees the already-updated row and matches zero rows once the winner's
// statement has committed. `affectedRows` reflects CHANGED rows (not merely
// matched rows) because the connection pool does not set the
// CLIENT_FOUND_ROWS capability flag (src/config/database.js) — that is fine
// here because every WHERE clause below is constructed so a match always
// implies a real change (the WHERE excludes the SET's target end-state).
// =============================================================================

const db = require('../config/database');
const eventBus = require('./eventBus');
const logger = require('../utils/logger').child({ service: 'deviceStatusService' });

const OFFLINE_THRESHOLD = 3;

/**
 * Record the result of one poll attempt for a device and run the up/down
 * state machine. Call this from a polling path right after success/failure is
 * already known.
 *
 * @param {number} deviceId
 * @param {boolean} success
 * @param {string|null} [errorMessage] - only meaningful when success is false
 */
async function recordPollResult(deviceId, success, errorMessage = null) {
  if (success) {
    // Atomic conditional flip: ONLY the caller whose UPDATE actually changes
    // a REAL detected outage (status='offline' AND the failure count had
    // actually crossed the threshold) back to 'online' gets to emit
    // device.online. See the module doc comment for the concurrency
    // reasoning and why affectedRows === 1 is the right check here.
    const [flipResult] = await db.query(
      `UPDATE devices
       SET consecutive_poll_failures = 0, status = 'online'
       WHERE id = ? AND status = 'offline' AND consecutive_poll_failures >= ?`,
      [deviceId, OFFLINE_THRESHOLD],
    );
    const wonTheFlip = flipResult.affectedRows === 1;

    // Quiet bookkeeping — ALWAYS runs, regardless of who won the flip above:
    // this is the only place last_polled_at/last_poll_error get reset on
    // success (the flip UPDATE above only touches
    // status/consecutive_poll_failures), and it also covers the never-polled
    // default case (status='offline', failures never crossed the threshold)
    // by silently setting status='online' too, with no emit — the
    // first-deploy stampede guard described above. Must run AFTER the flip
    // UPDATE, or it would race its own emit decision (it would already have
    // flipped status to 'online' before the flip UPDATE's WHERE got a chance
    // to see 'offline'). Never touches 'maintenance'.
    await db.query(
      `UPDATE devices
       SET last_polled_at = NOW(), last_poll_error = NULL, consecutive_poll_failures = 0,
           status = CASE WHEN status = 'offline' THEN 'online' ELSE status END
       WHERE id = ? AND status != 'maintenance'`,
      [deviceId],
    );

    if (wonTheFlip) {
      await emitDeviceEvent('device.online', deviceId);
    }
    return;
  }

  // Failure path. The increment is atomic SQL-side (`col = col + 1`, never a
  // JS-computed read-then-write), so two concurrent failures for the same
  // device can never lose an increment — see module doc comment.
  await db.query(
    `UPDATE devices
     SET consecutive_poll_failures = consecutive_poll_failures + 1,
         last_polled_at = NOW(),
         last_poll_error = ?
     WHERE id = ?`,
    [errorMessage, deviceId],
  );

  // Atomic conditional flip to offline — same "only the winner emits"
  // pattern as the success path above.
  const [flipResult] = await db.query(
    `UPDATE devices
     SET status = 'offline'
     WHERE id = ? AND status NOT IN ('offline', 'maintenance') AND consecutive_poll_failures >= ?`,
    [deviceId, OFFLINE_THRESHOLD],
  );
  const wonTheFlip = flipResult.affectedRows === 1;

  if (wonTheFlip) {
    await emitDeviceEvent('device.offline', deviceId);
  }
}

/**
 * Fetch the device row (for the emit payload) and fire the event. Only
 * called by the winner of a flip UPDATE above, so this extra SELECT only
 * runs on an actual detected transition, not on every poll result. Reads the
 * row AFTER the winning UPDATE has committed, so status/consecutive_poll_failures
 * already reflect the just-applied change — no need to fabricate them.
 */
async function emitDeviceEvent(eventName, deviceId) {
  const [[device]] = await db.query(
    `SELECT id, organization_id, name, ip_address, type, status, consecutive_poll_failures
     FROM devices WHERE id = ? AND deleted_at IS NULL`,
    [deviceId],
  );
  if (!device) return;
  eventBus.emit(eventName, {
    organizationId: device.organization_id,
    device,
  }).catch(err => logger.warn({ err: err.message, deviceId }, `${eventName} emit failed`));
}

module.exports = { recordPollResult, OFFLINE_THRESHOLD };
