// =============================================================================
// FireISP 5.0 — Data Usage / Bandwidth Metering Service
// =============================================================================
// Aggregates connection_logs data into per-client / per-contract usage
// summaries. Supports data caps, usage alerts, and metered billing.
// =============================================================================

const db = require('../config/database');

/**
 * Get data usage summary for a specific client across all contracts.
 */
async function getClientUsage(clientId, { from, to } = {}) {
  let sql = `
    SELECT
      client_id,
      COUNT(DISTINCT session_id) AS session_count,
      COALESCE(SUM(bytes_in), 0) AS total_bytes_in,
      COALESCE(SUM(bytes_out), 0) AS total_bytes_out,
      COALESCE(SUM(bytes_in + bytes_out), 0) AS total_bytes,
      COALESCE(SUM(session_duration), 0) AS total_duration_seconds,
      MIN(event_at) AS period_start,
      MAX(event_at) AS period_end
    FROM connection_logs
    WHERE client_id = ? AND event_type IN ('stop', 'interim-update')
  `;
  const params = [clientId];

  if (from) { sql += ' AND event_at >= ?'; params.push(from); }
  if (to) { sql += ' AND event_at <= ?'; params.push(to); }

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
  };
}

/**
 * Get daily usage breakdown for a contract.
 */
async function getDailyUsage(contractId, { from, to } = {}) {
  let sql = `
    SELECT
      DATE(event_at) AS date,
      COALESCE(SUM(bytes_in), 0) AS bytes_in,
      COALESCE(SUM(bytes_out), 0) AS bytes_out,
      COALESCE(SUM(bytes_in + bytes_out), 0) AS bytes_total,
      COUNT(DISTINCT session_id) AS sessions,
      COALESCE(SUM(session_duration), 0) AS duration_seconds
    FROM connection_logs
    WHERE contract_id = ? AND event_type IN ('stop', 'interim-update')
  `;
  const params = [contractId];

  if (from) { sql += ' AND event_at >= ?'; params.push(from); }
  if (to) { sql += ' AND event_at <= ?'; params.push(to); }

  sql += ' GROUP BY DATE(event_at) ORDER BY date DESC LIMIT 90';
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
  }));
}

/**
 * Get top users by bandwidth in an organization.
 */
async function getTopUsers(organizationId, { from, to, limit = 20 } = {}) {
  let sql = `
    SELECT
      cl.contract_id,
      cl.client_id,
      COALESCE(SUM(cl.bytes_in), 0) AS bytes_in,
      COALESCE(SUM(cl.bytes_out), 0) AS bytes_out,
      COALESCE(SUM(cl.bytes_in + cl.bytes_out), 0) AS bytes_total
    FROM connection_logs cl
    JOIN contracts c ON c.id = cl.contract_id
    WHERE c.organization_id = ?
      AND cl.event_type IN ('stop', 'interim-update')
  `;
  const params = [organizationId];

  if (from) { sql += ' AND cl.event_at >= ?'; params.push(from); }
  if (to) { sql += ' AND cl.event_at <= ?'; params.push(to); }

  sql += ' GROUP BY cl.contract_id, cl.client_id ORDER BY bytes_total DESC LIMIT ?';
  params.push(limit);

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    contract_id: r.contract_id,
    client_id: r.client_id,
    download_gb: parseFloat((r.bytes_in / 1073741824).toFixed(3)),
    upload_gb: parseFloat((r.bytes_out / 1073741824).toFixed(3)),
    total_gb: parseFloat((r.bytes_total / 1073741824).toFixed(3)),
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
      COALESCE(SUM(cl.bytes_in + cl.bytes_out), 0) AS bytes_used
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    LEFT JOIN connection_logs cl ON cl.contract_id = c.id
      AND cl.event_type IN ('stop', 'interim-update')
      AND cl.event_at >= ?
    WHERE c.organization_id = ?
      AND c.status = 'active'
      AND p.data_cap_gb IS NOT NULL
      AND p.data_cap_gb > 0
    GROUP BY c.id, c.client_id, p.data_cap_gb
    HAVING bytes_used > (p.data_cap_gb * 1073741824)
  `, [firstOfMonth, organizationId]);

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
      COALESCE(SUM(cl.bytes_in + cl.bytes_out), 0) AS bytes_used
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    LEFT JOIN connection_logs cl ON cl.contract_id = c.id
      AND cl.event_type IN ('stop', 'interim-update')
      AND cl.event_at >= ?
    WHERE c.organization_id = ?
      AND c.status = 'active'
      AND (p.fup_threshold_gb IS NOT NULL OR p.fup_threshold_percent IS NOT NULL)
      AND (p.fup_download_speed_mbps IS NOT NULL OR p.fup_upload_speed_mbps IS NOT NULL)
    GROUP BY c.id, c.client_id, p.data_cap_gb, p.fup_threshold_gb, p.fup_threshold_percent,
             p.fup_download_speed_mbps, p.fup_upload_speed_mbps
  `, [firstOfMonth, organizationId]);

  const BYTES_PER_GB = 1073741824;

  return rows
    .filter(r => {
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
