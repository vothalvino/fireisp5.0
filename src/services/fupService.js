// =============================================================================
// FireISP 5.0 — FUP (Fair Use Policy) Throttle Service
// =============================================================================
// Applies and restores FUP speed throttling for contracts that have exceeded
// their plan's fair-use policy threshold.
// =============================================================================

const db = require('../config/database');
const radiusService = require('./radiusService');
const logger = require('../utils/logger').child({ service: 'fup' });

/**
 * Apply FUP throttle to a contract by sending a RADIUS CoA and logging the action.
 *
 * @param {number} contractId
 * @returns {object} Result with coa_sent flag and log entry id
 */
async function applyFupThrottle(contractId) {
  logger.info({ contractId }, 'Applying FUP throttle');

  const [rows] = await db.query(`
    SELECT c.id AS contract_id, c.organization_id,
           p.fup_download_speed_mbps, p.fup_upload_speed_mbps
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    WHERE c.id = ?
  `, [contractId]);

  if (rows.length === 0) {
    return { applied: false, message: 'Contract not found' };
  }

  const row = rows[0];
  let coaSent = false;
  let coaResponse;

  try {
    const coaResult = await radiusService.changeOfAuth(contractId, 'throttle');
    coaSent = true;
    coaResponse = JSON.stringify(coaResult).slice(0, 200);
  } catch (err) {
    coaResponse = err.message ? err.message.slice(0, 200) : 'CoA failed';
  }

  const [result] = await db.query(
    `INSERT INTO plan_throttle_logs
     (organization_id, contract_id, action, reason, throttle_download_mbps, throttle_upload_mbps, coa_sent, coa_response)
     VALUES (?, ?, 'throttle', 'fup', ?, ?, ?, ?)`,
    [row.organization_id, contractId, row.fup_download_speed_mbps, row.fup_upload_speed_mbps, coaSent ? 1 : 0, coaResponse],
  );

  return {
    applied: true,
    log_id: result.insertId,
    coa_sent: coaSent,
    throttle_download_mbps: row.fup_download_speed_mbps,
    throttle_upload_mbps: row.fup_upload_speed_mbps,
  };
}

/**
 * Restore normal speeds for a contract after FUP period ends.
 *
 * @param {number} contractId
 * @returns {object} Result with coa_sent flag and log entry id
 */
async function restoreFupSpeeds(contractId) {
  logger.info({ contractId }, 'Restoring FUP speeds');

  const [rows] = await db.query(
    'SELECT id, organization_id FROM contracts WHERE id = ?',
    [contractId],
  );

  if (rows.length === 0) {
    return { restored: false, message: 'Contract not found' };
  }

  const row = rows[0];
  let coaSent = false;
  let coaResponse;

  try {
    const coaResult = await radiusService.changeOfAuth(contractId, 'restore');
    coaSent = true;
    coaResponse = JSON.stringify(coaResult).slice(0, 200);
  } catch (err) {
    coaResponse = err.message ? err.message.slice(0, 200) : 'CoA failed';
  }

  const [result] = await db.query(
    `INSERT INTO plan_throttle_logs
     (organization_id, contract_id, action, reason, coa_sent, coa_response)
     VALUES (?, ?, 'restore', 'fup', ?, ?)`,
    [row.organization_id, contractId, coaSent ? 1 : 0, coaResponse],
  );

  return {
    restored: true,
    log_id: result.insertId,
    coa_sent: coaSent,
  };
}

module.exports = { applyFupThrottle, restoreFupSpeeds };
