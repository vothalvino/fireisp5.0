// =============================================================================
// FireISP 5.0 — Data Usage / Bandwidth Metering Service
// =============================================================================
// Aggregates application-ingested monotonic deltas. Mutable connection_logs
// projections and legacy cumulative Interim rows are deliberately not summed.
// =============================================================================

const db = require('../config/database');
const { buildUnverifiableSessionOverlap } = require('../utils/accountingUsageCompleteness');

/**
 * Get data usage summary for a specific client across all contracts.
 */
async function getClientUsage(clientId, { organizationId, from, to } = {}) {
  const overlapStartSql = from ? 'DATE(?)' : "TIMESTAMP('1970-01-01 00:00:00')";
  const overlapEndSql = to ? 'DATE_ADD(DATE(?), INTERVAL 1 DAY)' : 'UTC_TIMESTAMP(3)';
  const overlapParams = [organizationId, clientId];
  if (from) overlapParams.push(from);
  if (to) overlapParams.push(to);
  let sql = `
    SELECT
      client_id,
      COUNT(DISTINCT session_instance_id) AS session_count,
      COALESCE(SUM(bytes_in_delta), 0) AS total_bytes_in,
      COALESCE(SUM(bytes_out_delta), 0) AS total_bytes_out,
      COALESCE(SUM(bytes_in_delta + bytes_out_delta), 0) AS total_bytes,
      COALESCE(SUM(duration_delta), 0) AS total_duration_seconds,
      COALESCE(SUM(is_complete = 0), 0) AS incomplete_rows,
      COUNT(*) AS observed_rows,
      MIN(usage_date) AS period_start,
      MAX(usage_date) AS period_end,
      (SELECT COUNT(*) FROM connection_logs unverifiable
        WHERE unverifiable.organization_id = ? AND unverifiable.client_id = ?
          AND ${buildUnverifiableSessionOverlap(
    'unverifiable', overlapStartSql, overlapEndSql,
  )}) AS unverifiable_session_rows
    FROM radius_accounting_usage_daily
    WHERE organization_id = ? AND client_id = ?
  `;
  const params = [...overlapParams, organizationId, clientId];

  if (from) { sql += ' AND usage_date >= ?'; params.push(from); }
  if (to) { sql += ' AND usage_date <= ?'; params.push(to); }

  const [rows] = await db.query(sql, params);
  const r = rows[0];

  return {
    client_id: clientId,
    period: { from: from || r.period_start, to: to || r.period_end },
    sessions: r.session_count,
    download_bytes: r.total_bytes_in,
    upload_bytes: r.total_bytes_out,
    total_bytes: r.total_bytes,
    download_gb: parseFloat((r.total_bytes_in / 1073741824).toFixed(3)),
    upload_gb: parseFloat((r.total_bytes_out / 1073741824).toFixed(3)),
    total_gb: parseFloat((r.total_bytes / 1073741824).toFixed(3)),
    duration_seconds: r.total_duration_seconds,
    unverifiable_session_rows: Number(r.unverifiable_session_rows || 0),
    usage_complete: Number(r.observed_rows || 0) > 0
      && Number(r.incomplete_rows || 0) === 0
      && Number(r.unverifiable_session_rows || 0) === 0,
  };
}

/**
 * Get daily usage breakdown for a contract.
 */
async function getDailyUsage(contractId, { organizationId, from, to } = {}) {
  let sql = `
    SELECT
      u.usage_date AS date,
      COALESCE(SUM(u.bytes_in_delta), 0) AS bytes_in,
      COALESCE(SUM(u.bytes_out_delta), 0) AS bytes_out,
      COALESCE(SUM(u.bytes_in_delta + u.bytes_out_delta), 0) AS bytes_total,
      COUNT(DISTINCT u.session_instance_id) AS sessions,
      COALESCE(SUM(u.duration_delta), 0) AS duration_seconds,
      COALESCE(SUM(u.is_complete = 0), 0) AS incomplete_rows,
      (SELECT COUNT(*) FROM connection_logs unverifiable
        WHERE unverifiable.organization_id = ? AND unverifiable.contract_id = ?
          AND ${buildUnverifiableSessionOverlap(
    'unverifiable', 'u.usage_date', 'DATE_ADD(u.usage_date, INTERVAL 1 DAY)',
  )}) AS unverifiable_session_rows
    FROM radius_accounting_usage_daily u
    WHERE u.organization_id = ? AND u.contract_id = ?
  `;
  const params = [organizationId, contractId, organizationId, contractId];

  if (from) { sql += ' AND u.usage_date >= ?'; params.push(from); }
  if (to) { sql += ' AND u.usage_date <= ?'; params.push(to); }

  sql += ' GROUP BY u.usage_date ORDER BY date DESC LIMIT 90';
  const [rows] = await db.query(sql, params);

  return rows.map(r => ({
    date: r.date,
    download_bytes: r.bytes_in,
    upload_bytes: r.bytes_out,
    total_bytes: r.bytes_total,
    download_gb: parseFloat((r.bytes_in / 1073741824).toFixed(3)),
    upload_gb: parseFloat((r.bytes_out / 1073741824).toFixed(3)),
    total_gb: parseFloat((r.bytes_total / 1073741824).toFixed(3)),
    sessions: r.sessions,
    duration_seconds: r.duration_seconds,
    unverifiable_session_rows: Number(r.unverifiable_session_rows || 0),
    usage_complete: Number(r.incomplete_rows || 0) === 0
      && Number(r.unverifiable_session_rows || 0) === 0,
  }));
}

/**
 * Get top users by bandwidth in an organization.
 */
async function getTopUsers(organizationId, { from, to, limit = 20 } = {}) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
  const overlapStartSql = from ? 'DATE(?)' : "TIMESTAMP('1970-01-01 00:00:00')";
  const overlapEndSql = to ? 'DATE_ADD(DATE(?), INTERVAL 1 DAY)' : 'UTC_TIMESTAMP(3)';
  const overlapParams = [];
  if (from) overlapParams.push(from);
  if (to) overlapParams.push(to);
  let sql = `
    SELECT
      u.contract_id,
      u.client_id,
      COALESCE(SUM(u.bytes_in_delta), 0) AS bytes_in,
      COALESCE(SUM(u.bytes_out_delta), 0) AS bytes_out,
      COALESCE(SUM(u.bytes_in_delta + u.bytes_out_delta), 0) AS bytes_total,
      COALESCE(SUM(u.is_complete = 0), 0) AS incomplete_rows,
      (SELECT COUNT(*) FROM connection_logs unverifiable
        WHERE unverifiable.organization_id = u.organization_id
          AND unverifiable.contract_id <=> u.contract_id
          AND unverifiable.client_id <=> u.client_id
          AND ${buildUnverifiableSessionOverlap(
    'unverifiable', overlapStartSql, overlapEndSql,
  )}) AS unverifiable_session_rows
    FROM radius_accounting_usage_daily u
    WHERE u.organization_id = ?
  `;
  const params = [...overlapParams, organizationId];

  if (from) { sql += ' AND u.usage_date >= ?'; params.push(from); }
  if (to) { sql += ' AND u.usage_date <= ?'; params.push(to); }

  sql += ` GROUP BY u.organization_id, u.contract_id, u.client_id ORDER BY bytes_total DESC LIMIT ${safeLimit}`;

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    contract_id: r.contract_id,
    client_id: r.client_id,
    download_gb: parseFloat((r.bytes_in / 1073741824).toFixed(3)),
    upload_gb: parseFloat((r.bytes_out / 1073741824).toFixed(3)),
    total_gb: parseFloat((r.bytes_total / 1073741824).toFixed(3)),
    unverifiable_session_rows: Number(r.unverifiable_session_rows || 0),
    usage_complete: Number(r.incomplete_rows || 0) === 0
      && Number(r.unverifiable_session_rows || 0) === 0,
  }));
}

/**
 * Check data cap usage for contracts with bandwidth limits.
 * Returns contracts that have exceeded their monthly data cap.
 */
async function checkDataCaps(organizationId) {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [rows] = await db.query(`
    SELECT
      c.id AS contract_id,
      c.client_id,
      p.data_cap_gb,
      COALESCE(SUM(CASE WHEN u.is_complete = 1 THEN u.bytes_in_delta + u.bytes_out_delta ELSE 0 END), 0) AS bytes_used,
      COALESCE(SUM(u.is_complete = 0), 0) AS incomplete_rows,
      COUNT(u.id) AS observed_rows,
      (SELECT COUNT(*) FROM connection_logs unverifiable
        WHERE unverifiable.organization_id = c.organization_id
          AND unverifiable.contract_id = c.id
          AND ${buildUnverifiableSessionOverlap('unverifiable', '?', 'UTC_TIMESTAMP(3)')}) AS unverifiable_session_rows
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    LEFT JOIN radius_accounting_usage_daily u ON u.contract_id = c.id
      AND u.organization_id = c.organization_id
      AND u.usage_date >= ?
    WHERE c.organization_id = ?
      AND c.status = 'active'
      AND p.data_cap_gb IS NOT NULL
      AND p.data_cap_gb > 0
    GROUP BY c.id, c.client_id, p.data_cap_gb
    HAVING observed_rows > 0 AND incomplete_rows = 0 AND unverifiable_session_rows = 0
       AND bytes_used > (p.data_cap_gb * 1073741824)
  `, [firstOfMonth, firstOfMonth, organizationId]);

  return rows.map(r => ({
    contract_id: r.contract_id,
    client_id: r.client_id,
    cap_gb: r.data_cap_gb,
    used_gb: parseFloat((r.bytes_used / 1073741824).toFixed(3)),
    usage_pct: parseFloat(((r.bytes_used / (r.data_cap_gb * 1073741824)) * 100).toFixed(1)),
  }));
}

/**
 * Check FUP (Fair Use Policy) threshold usage for contracts.
 * Returns contracts where usage has exceeded their plan's FUP threshold
 * but NOT the hard data cap (those are handled by checkDataCaps).
 */
async function checkFupThresholds(organizationId) {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [rows] = await db.query(`
    SELECT
      c.id AS contract_id,
      c.client_id,
      p.data_cap_gb,
      p.fup_threshold_gb,
      p.fup_threshold_percent,
      p.fup_download_speed_mbps,
      p.fup_upload_speed_mbps,
      COALESCE(SUM(CASE WHEN u.is_complete = 1 THEN u.bytes_in_delta + u.bytes_out_delta ELSE 0 END), 0) AS bytes_used,
      COALESCE(SUM(u.is_complete = 0), 0) AS incomplete_rows,
      COUNT(u.id) AS observed_rows,
      (SELECT COUNT(*) FROM connection_logs unverifiable
        WHERE unverifiable.organization_id = c.organization_id
          AND unverifiable.contract_id = c.id
          AND ${buildUnverifiableSessionOverlap('unverifiable', '?', 'UTC_TIMESTAMP(3)')}) AS unverifiable_session_rows
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    LEFT JOIN radius_accounting_usage_daily u ON u.contract_id = c.id
      AND u.organization_id = c.organization_id
      AND u.usage_date >= ?
    WHERE c.organization_id = ?
      AND c.status = 'active'
      AND (p.fup_threshold_gb IS NOT NULL OR p.fup_threshold_percent IS NOT NULL)
      AND (p.fup_download_speed_mbps IS NOT NULL OR p.fup_upload_speed_mbps IS NOT NULL)
    GROUP BY c.id, c.client_id, p.data_cap_gb, p.fup_threshold_gb, p.fup_threshold_percent,
             p.fup_download_speed_mbps, p.fup_upload_speed_mbps
  `, [firstOfMonth, firstOfMonth, organizationId]);

  const BYTES_PER_GB = 1073741824;

  return rows
    .filter(r => {
      if (Number(r.observed_rows || 0) === 0 || Number(r.incomplete_rows || 0) > 0
          || Number(r.unverifiable_session_rows || 0) > 0) return false;
      const usedGb = r.bytes_used / BYTES_PER_GB;
      // Calculate threshold in GB
      let thresholdGb = r.fup_threshold_gb;
      if (thresholdGb === null && r.fup_threshold_percent !== null && r.data_cap_gb !== null) {
        thresholdGb = r.data_cap_gb * (r.fup_threshold_percent / 100);
      }
      if (thresholdGb === null) return false;

      const overThreshold = usedGb > thresholdGb;
      // Not over the hard cap (or no hard cap)
      const notOverCap = r.data_cap_gb === null || usedGb <= r.data_cap_gb;
      return overThreshold && notOverCap;
    })
    .map(r => ({
      contract_id: r.contract_id,
      client_id: r.client_id,
      threshold_gb: r.fup_threshold_gb ||
        (r.fup_threshold_percent !== null && r.data_cap_gb !== null
          ? r.data_cap_gb * (r.fup_threshold_percent / 100)
          : null),
      used_gb: parseFloat((r.bytes_used / BYTES_PER_GB).toFixed(3)),
      fup_download_speed_mbps: r.fup_download_speed_mbps,
      fup_upload_speed_mbps: r.fup_upload_speed_mbps,
    }));
}

module.exports = { getClientUsage, getDailyUsage, getTopUsers, checkDataCaps, checkFupThresholds };
