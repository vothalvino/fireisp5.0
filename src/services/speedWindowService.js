// =============================================================================
// FireISP 5.0 — Speed Window Service
// =============================================================================
// Manages time-based speed windows for plans. Checks the current time and
// day-of-week bitmask to determine the active window, and applies it via
// RADIUS CoA for all active contracts on a plan.
// =============================================================================

const db = require('../config/database');
const radiusService = require('./radiusService');
const logger = require('../utils/logger').child({ service: 'speedWindow' });

/**
 * Get the currently active speed window for a plan.
 * Returns the highest-priority (lowest priority number) window that matches
 * the current time and day of week.
 *
 * @param {number} planId
 * @returns {object|null} Speed window row or null if none active
 */
async function getActiveWindow(planId) {
  const now = new Date();
  const dayBit = 1 << now.getDay(); // bit0=Sun,...,bit6=Sat
  const currentTime = now.toTimeString().slice(0, 8); // HH:MM:SS

  const [rows] = await db.query(`
    SELECT *
    FROM plan_speed_windows
    WHERE plan_id = ?
      AND status = 'active'
      AND deleted_at IS NULL
      AND (day_mask & ?) > 0
      AND start_time <= ?
      AND end_time > ?
    ORDER BY priority ASC, id ASC
    LIMIT 1
  `, [planId, dayBit, currentTime, currentTime]);

  return rows[0] || null;
}

/**
 * Apply active speed windows to all active contracts in an organization.
 * Sends RADIUS CoA for each contract whose plan has an active window.
 *
 * @param {number|null} organizationId - null for global (all orgs)
 * @returns {object} Summary of results
 */
async function applySpeedWindows(organizationId) {
  const orgFilter = organizationId ? 'AND c.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [contracts] = await db.query(`
    SELECT c.id AS contract_id, c.plan_id
    FROM contracts c
    WHERE c.status = 'active'
      AND c.deleted_at IS NULL
      ${orgFilter}
  `, params);

  let applied = 0;
  let skipped = 0;
  let errors = 0;

  for (const contract of contracts) {
    try {
      const window = await getActiveWindow(contract.plan_id);
      if (window) {
        await radiusService.changeOfAuth(contract.contract_id, 'update');
        applied++;
      } else {
        skipped++;
      }
    } catch (err) {
      logger.warn({ contractId: contract.contract_id, err: err.message }, 'Failed to apply speed window');
      errors++;
    }
  }

  return { applied, skipped, errors, total: contracts.length };
}

module.exports = { getActiveWindow, applySpeedWindows };
