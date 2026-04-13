// =============================================================================
// FireISP 5.0 — RADIUS Service
// =============================================================================
// Provides RADIUS account synchronization, session management, and
// FreeRADIUS SQL integration helpers.
// =============================================================================

const db = require('../config/database');
const { sendRadiusDisconnect, sendRadiusCoA } = require('./suspensionService');
const logger = require('../utils/logger').child({ service: 'radius' });

const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Synchronize a RADIUS account with its contract's current plan attributes.
 * Ensures the radius row has the correct speed/policy settings.
 */
async function syncAccount(contractId) {
  logger.info({ contractId }, 'Syncing RADIUS account');
  const [rows] = await db.query(`
    SELECT c.id AS contract_id, c.status AS contract_status,
           p.download_speed, p.upload_speed, p.name AS plan_name,
           r.id AS radius_id, r.username, r.status AS radius_status
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    LEFT JOIN radius r ON r.contract_id = c.id
    WHERE c.id = ?
  `, [contractId]);

  if (rows.length === 0) {
    return { synced: false, message: 'Contract not found' };
  }

  const row = rows[0];
  if (!row.radius_id) {
    return { synced: false, message: 'No RADIUS account for this contract' };
  }

  // Sync status: if contract is active, radius should be active; if suspended, disabled
  const expectedStatus = row.contract_status === 'active' ? 'active' : 'disabled';
  if (row.radius_status !== expectedStatus) {
    await db.query('UPDATE radius SET status = ? WHERE id = ?', [expectedStatus, row.radius_id]);
  }

  return {
    synced: true,
    contract_id: contractId,
    radius_id: row.radius_id,
    username: row.username,
    status: expectedStatus,
    plan: row.plan_name,
    download_speed: row.download_speed,
    upload_speed: row.upload_speed,
  };
}

/**
 * Bulk sync all RADIUS accounts for an organization.
 */
async function syncAllAccounts(organizationId) {
  const orgFilter = organizationId ? 'AND c.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [contracts] = await db.query(`
    SELECT c.id FROM contracts c
    JOIN radius r ON r.contract_id = c.id
    WHERE c.status IN ('active', 'suspended') ${orgFilter}
  `, params);

  let synced = 0;
  let errors = 0;

  for (const contract of contracts) {
    try {
      await syncAccount(contract.id);
      synced++;
    } catch (_err) {
      errors++;
    }
  }

  return { synced, errors, total: contracts.length };
}

/**
 * Get the most recent active session for a contract from connection_logs.
 */
async function getActiveSession(contractId) {
  const [rows] = await db.query(`
    SELECT * FROM connection_logs
    WHERE contract_id = ? AND event_type = 'start'
      AND NOT EXISTS (
        SELECT 1 FROM connection_logs cl2
        WHERE cl2.session_id = connection_logs.session_id
          AND cl2.contract_id = connection_logs.contract_id
          AND cl2.event_type = 'stop'
      )
    ORDER BY event_at DESC LIMIT 1
  `, [contractId]);
  return rows[0] || null;
}

/**
 * Disconnect a subscriber's active session via RADIUS Disconnect-Request.
 */
async function disconnectSession(contractId) {
  return sendRadiusDisconnect(contractId);
}

/**
 * Send a RADIUS Change of Authorization for a live session.
 */
async function changeOfAuth(contractId, action) {
  return sendRadiusCoA(contractId, action || 'update');
}

/**
 * Get session history from connection_logs.
 */
async function getSessionHistory(contractId, { from, to } = {}) {
  let sql = 'SELECT * FROM connection_logs WHERE contract_id = ?';
  const params = [contractId];

  if (from) {
    sql += ' AND event_at >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND event_at <= ?';
    params.push(to);
  }

  sql += ' ORDER BY event_at DESC LIMIT 1000';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get aggregated data usage for a contract within a time window.
 */
async function getUsageSummary(contractId, { from, to } = {}) {
  let sql = `
    SELECT
      COUNT(*) AS session_count,
      COALESCE(SUM(bytes_in), 0) AS total_bytes_in,
      COALESCE(SUM(bytes_out), 0) AS total_bytes_out,
      COALESCE(SUM(bytes_in + bytes_out), 0) AS total_bytes,
      COALESCE(SUM(session_duration), 0) AS total_duration_seconds,
      COALESCE(SUM(packets_in), 0) AS total_packets_in,
      COALESCE(SUM(packets_out), 0) AS total_packets_out
    FROM connection_logs
    WHERE contract_id = ? AND event_type IN ('stop', 'interim-update')
  `;
  const params = [contractId];

  if (from) {
    sql += ' AND event_at >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND event_at <= ?';
    params.push(to);
  }

  const [rows] = await db.query(sql, params);
  const r = rows[0];

  return {
    contract_id: contractId,
    period: { from: from || null, to: to || null },
    sessions: r.session_count,
    bytes_in: r.total_bytes_in,
    bytes_out: r.total_bytes_out,
    bytes_total: r.total_bytes,
    duration_seconds: r.total_duration_seconds,
    packets_in: r.total_packets_in,
    packets_out: r.total_packets_out,
    // Human-readable
    download_gb: parseFloat((r.total_bytes_in / BYTES_PER_GB).toFixed(3)),
    upload_gb: parseFloat((r.total_bytes_out / BYTES_PER_GB).toFixed(3)),
    total_gb: parseFloat((r.total_bytes / BYTES_PER_GB).toFixed(3)),
  };
}

module.exports = {
  syncAccount,
  syncAllAccounts,
  getActiveSession,
  disconnectSession,
  changeOfAuth,
  getSessionHistory,
  getUsageSummary,
};
