// =============================================================================
// FireISP 5.0 — AI Support Metrics Service (§21.10)
// =============================================================================
// Computes and stores nightly KPI rollups from support conversation data.
// =============================================================================
'use strict';
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'aiSupportMetricsService' });

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

/**
 * Compute and upsert daily AI support KPIs for an organization.
 *
 * @param {number|string} orgId
 * @param {string|null} date - ISO date string (YYYY-MM-DD); defaults to yesterday
 * @returns {Promise<object>} - The upserted metrics row
 */
async function rollupMetrics(orgId, date) {
  const targetDate = date ?? new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const [rows] = await db.query(
    `SELECT status, escalated_at, created_at,
            TIMESTAMPDIFF(SECOND, created_at, IFNULL(updated_at, NOW())) AS handle_time
       FROM support_conversations
      WHERE organization_id = ? AND DATE(created_at) = ?`,
    [orgId, targetDate],
  );

  const totalConversations = rows.length;
  const totalEscalations = rows.filter(r => r.status === 'escalated').length;

  const resolutionRate = totalConversations > 0
    ? ((totalConversations - totalEscalations) / totalConversations) * 100
    : 0;
  const escalationRate = totalConversations > 0
    ? (totalEscalations / totalConversations) * 100
    : 0;
  const fcrRate = resolutionRate; // first contact resolution = resolution for now

  const handledRows = rows.filter(r => r.handle_time !== null && r.handle_time >= 0);
  const avgHandleTimeSec = handledRows.length > 0
    ? handledRows.reduce((sum, r) => sum + Number(r.handle_time), 0) / handledRows.length
    : 0;

  await db.query(
    `INSERT INTO ai_support_metrics
       (organization_id, period_date, resolution_rate, fcr_rate,
        avg_handle_time_sec, escalation_rate, csat_avg,
        false_positive_rate, avg_latency_ms,
        total_conversations, total_escalations)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       resolution_rate = VALUES(resolution_rate),
       fcr_rate = VALUES(fcr_rate),
       avg_handle_time_sec = VALUES(avg_handle_time_sec),
       escalation_rate = VALUES(escalation_rate),
       total_conversations = VALUES(total_conversations),
       total_escalations = VALUES(total_escalations),
       updated_at = NOW()`,
    [
      orgId,
      targetDate,
      Math.round(resolutionRate * 100) / 100,
      Math.round(fcrRate * 100) / 100,
      Math.round(avgHandleTimeSec),
      Math.round(escalationRate * 100) / 100,
      null,   // csat_avg — requires survey integration
      null,   // false_positive_rate — requires annotation pipeline
      null,   // avg_latency_ms — requires request-level timing
      totalConversations,
      totalEscalations,
    ],
  );

  logger.info({ orgId, date: targetDate, totalConversations, resolutionRate }, 'aiSupportMetrics: rollup complete');

  return {
    orgId,
    periodDate: targetDate,
    totalConversations,
    totalEscalations,
    resolutionRate: Math.round(resolutionRate * 100) / 100,
    fcrRate: Math.round(fcrRate * 100) / 100,
    avgHandleTimeSec: Math.round(avgHandleTimeSec),
    escalationRate: Math.round(escalationRate * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Get AI support metrics for a date range.
 *
 * @param {number|string} orgId
 * @param {string} dateFrom - ISO date (YYYY-MM-DD)
 * @param {string} dateTo   - ISO date (YYYY-MM-DD)
 * @returns {Promise<object[]>}
 */
async function getMetrics(orgId, dateFrom, dateTo) {
  const [rows] = await db.query(
    `SELECT *
       FROM ai_support_metrics
      WHERE organization_id = ? AND period_date BETWEEN ? AND ?
      ORDER BY period_date ASC`,
    [orgId, dateFrom, dateTo],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// CSAT (stubbed — requires survey integration)
// ---------------------------------------------------------------------------

/**
 * Get CSAT data for a date range.
 * STUBBED — returns null until survey integration is implemented.
 *
 * @param {number|string} orgId
 * @param {string} dateFrom
 * @param {string} dateTo
 * @returns {Promise<null>}
 */
async function getCsat(orgId, dateFrom, dateTo) { // eslint-disable-line no-unused-vars
  return null;
}

module.exports = { rollupMetrics, getMetrics, getCsat };
