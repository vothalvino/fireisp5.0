// =============================================================================
// FireISP 5.0 — Analytics Service (§18.4)
// =============================================================================
// Lightweight heuristic/statistical analytics — NOT real ML model training.
//
// Implementations:
//   - Anomaly detection: z-score over rolling SNMP metric window (heuristic)
//   - Predictive failure: SFP degradation + ONU offline threshold (heuristic)
//   - Alert correlation: reuses §6 alertService.evaluateAlerts()
//   - Bandwidth forecasting: reuses §15 reportService.capacityForecast() (linear regression)
//   - Churn scoring: rule-based signal aggregation (tenure/payment/ticket) (heuristic)
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'analyticsService' });

// Z-score threshold for anomaly detection (|z| > 2.5 = anomaly)
const Z_SCORE_THRESHOLD = 2.5;
// Min samples required for z-score calculation
const MIN_SAMPLES = 6;

// Churn signal weights (sum of weighted signals → 0-100 score)
const CHURN_WEIGHTS = {
  overdue_invoices:   30,
  suspensions_30d:    25,
  open_tickets:       15,
  tenure_decay:       20, // shorter tenure = higher risk
  payments_late_90d:  10,
};

// ---------------------------------------------------------------------------
// §18.4 Anomaly Detection
// ---------------------------------------------------------------------------

/**
 * Run z-score anomaly detection over recent SNMP metrics for an org.
 * Writes detected anomalies to analytics_anomalies table.
 * HEURISTIC: no ML — uses rolling mean + stddev over last N samples.
 *
 * @param {number} organizationId
 * @param {{ window?: number }} opts  window = samples to use for baseline (default 48)
 */
async function detectAnomalies(organizationId, { window: windowSize = 48 } = {}) {
  // Get distinct metric + device combinations
  const [combos] = await db.query(
    `SELECT DISTINCT m.metric, m.device_id
     FROM snmp_metrics m
     JOIN devices d ON d.id = m.device_id
     WHERE d.organization_id = ?
     LIMIT 500`,
    [organizationId],
  );

  let detected = 0;

  for (const { metric, device_id } of combos) {
    const [samples] = await db.query(
      `SELECT value FROM snmp_metrics
       WHERE device_id = ? AND metric = ?
       ORDER BY recorded_at DESC LIMIT ?`,
      [device_id, metric, windowSize],
    );

    if (samples.length < MIN_SAMPLES) continue;

    const values = samples.map(s => parseFloat(s.value));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);

    if (stddev === 0) continue; // constant metric, no anomaly possible

    const latest = values[0]; // most recent value
    const zScore = (latest - mean) / stddev;

    if (Math.abs(zScore) > Z_SCORE_THRESHOLD) {
      const severity = Math.abs(zScore) > 4 ? 'critical' : Math.abs(zScore) > 3 ? 'high' : 'medium';

      await db.query(
        `INSERT INTO analytics_anomalies
           (organization_id, device_id, metric, detected_value, baseline_mean,
            baseline_stddev, z_score, severity, anomaly_type, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'z_score', ?)`,
        [organizationId, device_id, metric, latest, mean, stddev, zScore, severity,
          `z-score ${zScore.toFixed(2)} exceeds threshold ±${Z_SCORE_THRESHOLD} (heuristic)`],
      );
      detected++;
    }
  }

  logger.info({ organizationId, combos: combos.length, detected }, 'Anomaly detection complete (heuristic z-score)');
  return { combos_checked: combos.length, anomalies_detected: detected };
}

/**
 * Predictive failure analysis — SFP degradation and ONU failure.
 * Heuristic thresholds: sfp_rx_power_dbm < -30 dBm = degraded.
 */
async function predictiveFailure(organizationId) {
  // SFP degradation: rx power < -30 dBm
  const [sfpRows] = await db.query(
    `SELECT m.device_id, m.value AS rx_power_dbm, d.name AS device_name
     FROM snmp_metrics m
     JOIN devices d ON d.id = m.device_id
     WHERE d.organization_id = ?
       AND m.metric = 'sfp_rx_power_dbm'
       AND m.value < -30
     ORDER BY m.value ASC LIMIT 50`,
    [organizationId],
  );

  // ONU offline > 5 min (via last_seen threshold)
  const [onuRows] = await db.query(
    `SELECT id, name, ip_address, last_seen_at
     FROM devices
     WHERE organization_id = ?
       AND device_type = 'onu'
       AND last_seen_at IS NOT NULL
       AND last_seen_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
     LIMIT 100`,
    [organizationId],
  );

  return {
    sfp_degradation: sfpRows.map(r => ({
      device_id: r.device_id,
      device_name: r.device_name,
      rx_power_dbm: parseFloat(r.rx_power_dbm),
      threshold_dbm: -30,
      risk: 'high',
      note: 'HEURISTIC: rx_power < -30 dBm indicates SFP degradation',
    })),
    onu_offline: onuRows.map(r => ({
      device_id: r.id,
      device_name: r.name,
      last_seen_at: r.last_seen_at,
      offline_minutes: Math.floor((Date.now() - new Date(r.last_seen_at).getTime()) / 60000),
      risk: 'high',
    })),
    generated_at: new Date().toISOString(),
    note: 'HEURISTIC analysis — not ML model predictions',
  };
}

/**
 * Smart alert correlation — surfaces recently grouped alerts to reduce noise.
 * Reuses §6 alert data. Groups by device + metric window.
 */
async function alertCorrelation(organizationId, { window_minutes = 30 } = {}) {
  const [groups] = await db.query(
    `SELECT
       rule_id,
       ar.name AS rule_name,
       ar.metric,
       ar.severity,
       COUNT(*) AS event_count,
       MIN(ae.triggered_at) AS first_at,
       MAX(ae.triggered_at) AS last_at
     FROM alert_events ae
     JOIN alert_rules ar ON ar.id = ae.rule_id
     WHERE ae.organization_id = ?
       AND ae.triggered_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
     GROUP BY ae.rule_id, ar.name, ar.metric, ar.severity
     HAVING event_count > 1
     ORDER BY event_count DESC`,
    [organizationId, window_minutes],
  );

  return {
    window_minutes,
    correlated_groups: groups.length,
    groups,
    generated_at: new Date().toISOString(),
    note: 'Alert correlation reuses §6 alert_events (rule-based grouping, not ML)',
  };
}

/**
 * Bandwidth forecasting — reuses §15 capacityForecast() (linear regression).
 * Returns the existing forecast with an analytics wrapper.
 */
async function bandwidthForecast(organizationId, { months = 6 } = {}) {
  const reportService = require('./reportService');
  const forecast = await reportService.capacityForecast(organizationId, { months });
  return {
    ...forecast,
    analytics_note: 'Bandwidth forecast reuses §15 reportService.capacityForecast() — linear regression over revenue_summary',
  };
}

// ---------------------------------------------------------------------------
// §18.4 Churn Prediction
// ---------------------------------------------------------------------------

/**
 * Compute rule-based churn scores for all active clients in an org.
 * HEURISTIC: aggregates tenure, overdue invoices, suspensions, tickets, late payments.
 * Writes to churn_scores table. NOT a trained ML model.
 */
async function computeChurnScores(organizationId) {
  // Get all active clients with signals
  const [clients] = await db.query(
    `SELECT
       cl.id AS client_id,
       TIMESTAMPDIFF(MONTH, MIN(co.created_at), NOW()) AS tenure_months,
       COALESCE(SUM(CASE WHEN i.status = 'issued' AND i.due_date < NOW() THEN 1 ELSE 0 END), 0) AS overdue_invoices,
       COALESCE(
         (SELECT COUNT(*) FROM suspension_logs sl WHERE sl.contract_id IN
           (SELECT id FROM contracts WHERE client_id = cl.id)
           AND sl.suspended_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0
       ) AS suspensions_30d,
       COALESCE(
         (SELECT COUNT(*) FROM tickets t WHERE t.client_id = cl.id AND t.status NOT IN ('closed','resolved')), 0
       ) AS open_tickets,
       COALESCE(
         (SELECT COUNT(*) FROM invoices ip WHERE ip.client_id = cl.id
           AND ip.paid_at IS NOT NULL AND ip.paid_at > ip.due_date
           AND ip.due_date >= DATE_SUB(NOW(), INTERVAL 90 DAY)), 0
       ) AS payments_late_90d
     FROM clients cl
     LEFT JOIN contracts co ON co.client_id = cl.id
     LEFT JOIN invoices i ON i.client_id = cl.id AND i.organization_id = ?
     WHERE cl.organization_id = ? AND cl.status = 'active'
     GROUP BY cl.id
     LIMIT 5000`,
    [organizationId, organizationId],
  );

  let scored = 0;
  for (const c of clients) {
    const score = computeChurnScore(c);
    const riskBand = score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';
    const factors = buildChurnFactors(c, score);

    await db.query(
      `INSERT INTO churn_scores
         (organization_id, client_id, score, risk_band, tenure_months,
          overdue_invoices, open_tickets, suspensions_30d, payments_late_90d, factors)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [organizationId, c.client_id, score, riskBand,
        c.tenure_months || 0, c.overdue_invoices, c.open_tickets,
        c.suspensions_30d, c.payments_late_90d, JSON.stringify(factors)],
    );
    scored++;
  }

  logger.info({ organizationId, scored }, 'Churn scores computed (heuristic rule-based)');
  return { clients_scored: scored };
}

function computeChurnScore(signals) {
  let score = 0;

  // Overdue invoices: each one adds weight
  score += Math.min(signals.overdue_invoices * 10, CHURN_WEIGHTS.overdue_invoices);

  // Suspensions in 30d
  score += Math.min(signals.suspensions_30d * 12, CHURN_WEIGHTS.suspensions_30d);

  // Open tickets
  score += Math.min(signals.open_tickets * 5, CHURN_WEIGHTS.open_tickets);

  // Tenure decay: short tenure = higher risk
  const tenure = parseInt(signals.tenure_months, 10) || 0;
  const tenureScore = tenure < 3 ? 20 : tenure < 6 ? 14 : tenure < 12 ? 8 : tenure < 24 ? 4 : 0;
  score += tenureScore;

  // Late payments
  score += Math.min(signals.payments_late_90d * 5, CHURN_WEIGHTS.payments_late_90d);

  return parseFloat(Math.min(100, score).toFixed(2));
}

function buildChurnFactors(signals, score) {
  return [
    { signal: 'overdue_invoices', value: signals.overdue_invoices, weight: CHURN_WEIGHTS.overdue_invoices },
    { signal: 'suspensions_30d',  value: signals.suspensions_30d,  weight: CHURN_WEIGHTS.suspensions_30d },
    { signal: 'open_tickets',     value: signals.open_tickets,     weight: CHURN_WEIGHTS.open_tickets },
    { signal: 'tenure_months',    value: signals.tenure_months,    weight: CHURN_WEIGHTS.tenure_decay },
    { signal: 'payments_late_90d',value: signals.payments_late_90d,weight: CHURN_WEIGHTS.payments_late_90d },
    { signal: 'total_score',      value: score,                    weight: 100 },
  ];
}

/**
 * Get current churn scores for an org with optional filters.
 */
async function getChurnScores(organizationId, { risk_band, page = 1, limit = 50 } = {}) {
  const conditions = ['cs.organization_id = ?'];
  const params = [organizationId];

  if (risk_band) { conditions.push('cs.risk_band = ?'); params.push(risk_band); }

  const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(parseInt(limit, 10), 100);
  // Latest score per client (subquery for most recent)
  const [rows] = await db.query(
    `SELECT cs.*, cl.first_name, cl.last_name, cl.email
     FROM churn_scores cs
     JOIN clients cl ON cl.id = cs.client_id
     INNER JOIN (
       SELECT client_id, MAX(scored_at) AS latest
       FROM churn_scores WHERE organization_id = ?
       GROUP BY client_id
     ) lcs ON lcs.client_id = cs.client_id AND lcs.latest = cs.scored_at
     WHERE ${conditions.join(' AND ')}
     ORDER BY cs.score DESC LIMIT ? OFFSET ?`,
    [organizationId, ...params, parseInt(limit, 10), offset],
  );
  const [countResult] = await db.query(
    `SELECT COUNT(DISTINCT cs.client_id) AS total
     FROM churn_scores cs
     WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return {
    data: rows,
    total: countResult[0].total,
    note: 'HEURISTIC rule-based churn scoring — not ML predictions',
  };
}

module.exports = {
  detectAnomalies,
  predictiveFailure,
  alertCorrelation,
  bandwidthForecast,
  computeChurnScores,
  getChurnScores,
  computeChurnScore,
  buildChurnFactors,
};
