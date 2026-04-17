// =============================================================================
// FireISP 5.0 — Monitoring Alerts & Notifications Engine
// =============================================================================
// Evaluates alert rules against SNMP metrics and network health data.
// Triggers notifications when thresholds are breached.
// =============================================================================

const db = require('../config/database');
const eventBus = require('./eventBus');
const logger = require('../utils/logger');

// Whitelist of metric columns allowed in alert rules.
// Any metric not in this set is rejected to prevent SQL injection.
const ALLOWED_METRICS = new Set([
  'cpu_usage',
  'memory_usage',
  'signal_strength',
  'latency_ms',
  'packet_loss',
  'uptime',
]);

/**
 * Evaluate all active alert rules for an organization.
 * Checks the latest SNMP metrics and network health snapshots against thresholds.
 */
async function evaluateAlerts(organizationId) {
  const [rules] = await db.query(
    'SELECT * FROM alert_rules WHERE organization_id = ? AND is_enabled = TRUE',
    [organizationId],
  );

  const triggered = [];

  for (const rule of rules) {
    try {
      const breached = await checkRule(rule);
      if (breached) {
        await recordAlert(rule, breached);
        triggered.push({ rule_id: rule.id, rule_name: rule.name, metric: rule.metric, ...breached });

        // Emit event for notification hooks
        eventBus.emit('alert.triggered', {
          organizationId,
          rule,
          breach: breached,
        });

        // Auto-create outage if configured
        if (rule.auto_create_outage && breached.device_id) {
          await autoCreateOutage(organizationId, rule, breached);
        }
      }
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, 'Alert rule evaluation failed');
    }
  }

  return { evaluated: rules.length, triggered: triggered.length, alerts: triggered };
}

/**
 * Check a single alert rule against current metrics.
 */
async function checkRule(rule) {
  const { metric, operator, threshold, device_id, duration_minutes } = rule;

  // Reject metrics not in the whitelist to prevent SQL injection
  if (!ALLOWED_METRICS.has(metric)) {
    return null;
  }

  // Build query based on metric type
  let sql;
  let params;

  if (['cpu_usage', 'memory_usage', 'signal_strength', 'latency_ms'].includes(metric)) {
    // SNMP metric check
    sql = `
      SELECT device_id, AVG(\`${metric}\`) AS avg_value, MAX(\`${metric}\`) AS max_value
      FROM snmp_metrics
      WHERE polled_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
    `;
    params = [duration_minutes || 5];

    if (device_id) {
      sql += ' AND device_id = ?';
      params.push(device_id);
    }

    sql += ' GROUP BY device_id';
  } else if (metric === 'packet_loss') {
    // Network health snapshot
    sql = `
      SELECT device_id, AVG(packet_loss_pct) AS avg_value, MAX(packet_loss_pct) AS max_value
      FROM network_health_snapshots
      WHERE snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `;
    params = [1];

    if (device_id) {
      sql += ' AND device_id = ?';
      params.push(device_id);
    }

    sql += ' GROUP BY device_id';
  } else if (metric === 'uptime') {
    sql = `
      SELECT device_id, AVG(uptime_pct) AS avg_value, MIN(uptime_pct) AS max_value
      FROM network_health_snapshots
      WHERE snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `;
    params = [1];

    if (device_id) {
      sql += ' AND device_id = ?';
      params.push(device_id);
    }

    sql += ' GROUP BY device_id';
  } else {
    return null;
  }

  const [rows] = await db.query(sql, params);

  for (const row of rows) {
    const value = parseFloat(row.avg_value);
    const thresholdVal = parseFloat(threshold);
    let breached = false;

    switch (operator) {
      case '>': breached = value > thresholdVal; break;
      case '>=': breached = value >= thresholdVal; break;
      case '<': breached = value < thresholdVal; break;
      case '<=': breached = value <= thresholdVal; break;
      case '==': breached = Math.abs(value - thresholdVal) < 0.001; break;
      default: break;
    }

    if (breached) {
      return {
        device_id: row.device_id,
        current_value: value,
        threshold: thresholdVal,
        operator,
        metric,
      };
    }
  }

  return null;
}

/**
 * Record an alert event in the alert_events table.
 */
async function recordAlert(rule, breach) {
  await db.query(
    `INSERT INTO alert_events
     (alert_rule_id, organization_id, device_id, metric, current_value, threshold_value, status)
     VALUES (?, ?, ?, ?, ?, ?, 'triggered')`,
    [rule.id, rule.organization_id, breach.device_id, breach.metric,
      breach.current_value, breach.threshold],
  );
}

/**
 * Auto-create an outage record when an alert fires.
 */
async function autoCreateOutage(organizationId, rule, breach) {
  try {
    await db.query(
      `INSERT INTO outages (organization_id, device_id, title, severity, status, started_at)
       VALUES (?, ?, ?, ?, 'active', NOW())`,
      [organizationId, breach.device_id,
        `Alert: ${rule.name} — ${breach.metric} ${breach.operator} ${breach.threshold}`,
        rule.severity || 'major'],
    );
  } catch (_err) {
    // Best effort — don't block alert processing
  }
}

/**
 * Get alert history for an organization.
 */
async function getAlertHistory(organizationId, { page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT ae.*, ar.name AS rule_name
     FROM alert_events ae
     JOIN alert_rules ar ON ar.id = ae.alert_rule_id
     WHERE ae.organization_id = ?
     ORDER BY ae.created_at DESC LIMIT ? OFFSET ?`,
    [organizationId, limit, offset],
  );
  const [countResult] = await db.query(
    'SELECT COUNT(*) AS total FROM alert_events WHERE organization_id = ?',
    [organizationId],
  );
  const total = countResult[0].total;
  return {
    data: rows,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Acknowledge an alert event.
 */
async function acknowledgeAlert(alertEventId, userId) {
  await db.query(
    'UPDATE alert_events SET status = ?, acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ?',
    ['acknowledged', userId, alertEventId],
  );
}

module.exports = { evaluateAlerts, checkRule, getAlertHistory, acknowledgeAlert };
