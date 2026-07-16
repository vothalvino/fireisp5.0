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
  'if_in_octets',
  'if_out_octets',
  'voltage_mv',
  'temperature_c',
  'fan_speed_rpm',
  'if_in_discards',
  'if_out_discards',
  'sfp_tx_power_dbm',
  'sfp_rx_power_dbm',
  'sfp_temperature_c',
  'ups_battery_pct',
  'ups_runtime_min',
  'poe_power_mw',
  'humidity_pct',
]);

// Metrics stored directly in snmp_metrics (used to build safe queries).
const SNMP_METRICS = new Set([
  'cpu_usage',
  'memory_usage',
  'signal_strength',
  'latency_ms',
  'if_in_octets',
  'if_out_octets',
  'voltage_mv',
  'temperature_c',
  'fan_speed_rpm',
  'if_in_discards',
  'if_out_discards',
  'sfp_tx_power_dbm',
  'sfp_rx_power_dbm',
  'sfp_temperature_c',
  'ups_battery_pct',
  'ups_runtime_min',
  'poe_power_mw',
  'humidity_pct',
]);

/**
 * Get all currently-active (not yet resolved) alert events for an
 * organization, with their rule's name/severity/description joined in.
 *
 * `alertService.getActiveAlerts` was called by supportContextService.js (AI
 * support context enrichment) but never existed here — that call was always
 * guarded with a `typeof === 'function'` check, so it silently never ran
 * rather than throwing; "active alerts" in the AI support context has always
 * been an empty array.
 *
 * @param {number|string} organizationId
 * @returns {Promise<Array>}
 */
async function getActiveAlerts(organizationId) {
  const [rows] = await db.query(
    `SELECT ae.id, ae.device_id, ae.current_value, ae.threshold_value, ae.status, ae.created_at,
            ar.name, ar.severity, ar.description, ar.metric
       FROM alert_events ae
       JOIN alert_rules ar ON ar.id = ae.alert_rule_id
      WHERE ae.organization_id = ? AND ae.status != 'resolved'
      ORDER BY ae.created_at DESC
      LIMIT 50`,
    [organizationId],
  );
  return rows;
}

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
  let suppressedCount = 0;

  for (const rule of rules) {
    try {
      const breached = await checkRule(rule);
      if (breached) {
        // Maintenance windows apply on the scheduled/cron path too — this is
        // the path taskRunner actually runs; previously only the manual
        // evaluate-v2 endpoint honored windows.
        if (breached.device_id) {
          const windowId = await activeMaintenanceWindowId(organizationId, breached.device_id);
          if (windowId) {
            await recordSuppressedAlert(organizationId, rule, breached, windowId);
            suppressedCount += 1;
            continue;
          }
        }
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

        // Auto-create ticket if configured
        if (rule.auto_create_ticket && breached.device_id) {
          await autoCreateTicket(organizationId, rule, breached);
        }
      }
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, 'Alert rule evaluation failed');
    }
  }

  return { evaluated: rules.length, triggered: triggered.length, suppressed: suppressedCount, alerts: triggered };
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

  if (SNMP_METRICS.has(metric)) {
    // SNMP metric check (includes bandwidth counters if_in_octets / if_out_octets)
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
    // `outages` has no organization_id column — it is scoped through its
    // device/site — and status is ENUM('ongoing','resolved','post_mortem'), so
    // an outage that has just started is 'ongoing' (database/schema.sql).
    await db.query(
      `INSERT INTO outages (device_id, title, severity, status, started_at)
       VALUES (?, ?, ?, 'ongoing', NOW())`,
      [breach.device_id,
        `Alert: ${rule.name} — ${breach.metric} ${breach.operator} ${breach.threshold}`,
        rule.severity || 'major'],
    );
  } catch (_err) {
    // Best effort — don't block alert processing
  }
}

/**
 * Auto-create a support ticket when an alert fires.
 * The ticket is linked to the device that breached the threshold.
 */
async function autoCreateTicket(organizationId, rule, breach) {
  try {
    const subject = `Alert: ${rule.name} — ${breach.metric} ${breach.operator} ${breach.threshold}`;
    const description = [
      'Threshold alert automatically opened by the monitoring system.',
      `Rule: ${rule.name}`,
      `Metric: ${breach.metric}`,
      `Condition: ${breach.metric} ${breach.operator} ${breach.threshold}`,
      `Current value: ${breach.current_value}`,
      `Device ID: ${breach.device_id}`,
    ].join('\n');

    await db.query(
      `INSERT INTO tickets
         (organization_id, subject, description, priority, category, status)
       VALUES (?, ?, ?, ?, 'technical', 'open')`,
      [organizationId, subject, description, rule.severity === 'critical' ? 'high' : 'medium'],
    );
  } catch (_err) {
    // Best effort — don't block alert processing
  }
}

/**
 * Get alert history for an organization.
 */
async function getAlertHistory(organizationId, { page = 1, limit = 50 } = {}) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const offset = (safePage - 1) * safeLimit;
  const [rows] = await db.query(
    `SELECT ae.*, ar.name AS rule_name
     FROM alert_events ae
     JOIN alert_rules ar ON ar.id = ae.alert_rule_id
     WHERE ae.organization_id = ?
     ORDER BY ae.created_at DESC LIMIT ${safeLimit} OFFSET ${offset}`,
    [organizationId],
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

/**
 * Active maintenance window covering a device, or null.
 *
 * Scoping (each window targets exactly one of):
 *   device-scoped — window.device_id = the device
 *   site-scoped   — window.site_id = the device's site (devices.site_id)
 *   org-wide      — neither set
 *
 * The previous implementation treated ANY window without a device_id as
 * org-wide, so a window scheduled for one tower suppressed alerts for every
 * device in the organization.
 */
async function activeMaintenanceWindowId(organizationId, deviceId) {
  const [rows] = await db.query(
    `SELECT mw.id FROM maintenance_windows mw
     LEFT JOIN devices d ON d.id = ?
     WHERE mw.organization_id = ? AND mw.deleted_at IS NULL
       AND (
         mw.device_id = ?
         OR (mw.device_id IS NULL AND mw.site_id IS NOT NULL AND mw.site_id = d.site_id)
         OR (mw.device_id IS NULL AND mw.site_id IS NULL)
       )
       AND (mw.status = 'active' OR (mw.status = 'scheduled' AND mw.starts_at <= NOW() AND mw.ends_at >= NOW()))
     LIMIT 1`,
    [deviceId, organizationId, deviceId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Check if a device is currently in a maintenance window.
 */
async function isInMaintenanceWindow(organizationId, deviceId) {
  return (await activeMaintenanceWindowId(organizationId, deviceId)) !== null;
}

/**
 * Record a breach that was suppressed by a maintenance window. Written as an
 * already-resolved, suppressed=1 event so it never alarms, escalates, or
 * feeds correlation — it exists purely as the audit trail ("this alert fired
 * during window X"). Best effort: history must never break evaluation.
 */
async function recordSuppressedAlert(organizationId, rule, breach, maintenanceWindowId) {
  try {
    await db.query(
      `INSERT INTO alert_events
         (alert_rule_id, organization_id, device_id, metric, current_value, threshold_value,
          status, suppressed, maintenance_window_id, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, 'resolved', 1, ?, NOW())`,
      [rule.id, organizationId, breach.device_id, breach.metric,
        breach.current_value, breach.threshold, maintenanceWindowId],
    );
  } catch (err) {
    logger.warn({ err, ruleId: rule.id, maintenanceWindowId }, 'Failed to record suppressed alert history');
  }
}

/**
 * Check if an alert should be suppressed due to an upstream device being in alert.
 */
async function isSuppressedByCorrelation(organizationId, deviceId) {
  const [rows] = await db.query(
    `SELECT sr.id FROM alert_suppression_rules sr
     JOIN alert_events ae ON ae.device_id = sr.upstream_device_id
       AND ae.organization_id = sr.organization_id
       AND ae.status = 'triggered'
     WHERE sr.organization_id = ? AND sr.downstream_device_id = ?
       AND sr.is_enabled = 1 AND sr.deleted_at IS NULL
     LIMIT 1`,
    [organizationId, deviceId],
  );
  return rows.length > 0;
}

/**
 * Check if an alert rule is flapping (toggling rapidly).
 */
async function checkFlapping(ruleId) {
  const [ruleRows] = await db.query(
    'SELECT flap_detection_enabled, flap_count_threshold, flap_window_minutes FROM alert_rules WHERE id = ?',
    [ruleId],
  );
  if (!ruleRows.length || !ruleRows[0].flap_detection_enabled) return false;
  const { flap_count_threshold, flap_window_minutes } = ruleRows[0];
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM alert_events
     WHERE alert_rule_id = ? AND suppressed = 0
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [ruleId, flap_window_minutes],
  );
  return parseInt(rows[0].cnt, 10) >= (flap_count_threshold || 3);
}

/**
 * Trigger an escalation step for an alert event.
 */
async function triggerEscalation(alertEventId, escalationChainId, stepNumber) {
  const [steps] = await db.query(
    'SELECT * FROM alert_escalation_steps WHERE chain_id = ? AND step_number = ?',
    [escalationChainId, stepNumber],
  );
  if (!steps.length) return;
  const step = steps[0];
  logger.info(
    { alertEventId, escalationChainId, stepNumber, channel: step.notification_channel },
    'Alert escalation triggered',
  );
  await db.query(
    'UPDATE alert_events SET escalation_step = ?, escalated_at = NOW() WHERE id = ?',
    [stepNumber, alertEventId],
  );
  eventBus.emit('alert.escalated', { alertEventId, escalationChainId, stepNumber, step });
}

/**
 * Enhanced alert evaluation (v2) with maintenance windows, suppression, and flap detection.
 */
async function evaluateAlertsV2(organizationId) {
  const [rules] = await db.query(
    'SELECT * FROM alert_rules WHERE organization_id = ? AND is_enabled = TRUE',
    [organizationId],
  );

  const triggered = [];
  const suppressed = [];

  for (const rule of rules) {
    try {
      const breached = await checkRule(rule);
      if (!breached) continue;

      // Maintenance window check
      if (breached.device_id) {
        const windowId = await activeMaintenanceWindowId(organizationId, breached.device_id);
        if (windowId) {
          await recordSuppressedAlert(organizationId, rule, breached, windowId);
          suppressed.push({ rule_id: rule.id, reason: 'maintenance_window', maintenance_window_id: windowId });
          continue;
        }
      }

      // Correlation suppression check
      if (breached.device_id) {
        const isSuppressed = await isSuppressedByCorrelation(organizationId, breached.device_id);
        if (isSuppressed) {
          suppressed.push({ rule_id: rule.id, reason: 'correlation_suppression' });
          continue;
        }
      }

      // Flapping check
      const isFlapping = await checkFlapping(rule.id);

      // Record the alert event
      const [result] = await db.query(
        `INSERT INTO alert_events
         (alert_rule_id, organization_id, device_id, metric, current_value, threshold_value, status, flapping)
         VALUES (?, ?, ?, ?, ?, ?, 'triggered', ?)`,
        [rule.id, organizationId, breached.device_id, breached.metric,
          breached.current_value, breached.threshold, isFlapping ? 1 : 0],
      );
      const eventId = result.insertId;

      triggered.push({ rule_id: rule.id, rule_name: rule.name, metric: rule.metric, flapping: isFlapping, ...breached });

      eventBus.emit('alert.triggered', { organizationId, rule, breach: breached });

      if (rule.auto_create_outage && breached.device_id) {
        await autoCreateOutage(organizationId, rule, breached);
      }
      if (rule.auto_create_ticket && breached.device_id) {
        await autoCreateTicket(organizationId, rule, breached);
      }

      // Escalation
      if (rule.escalation_chain_id) {
        await triggerEscalation(eventId, rule.escalation_chain_id, 1);
      }
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, 'Alert rule v2 evaluation failed');
    }
  }

  return {
    evaluated: rules.length,
    triggered: triggered.length,
    suppressed: suppressed.length,
    alerts: triggered,
    suppressed_alerts: suppressed,
  };
}

module.exports = {
  evaluateAlerts, checkRule, getAlertHistory, acknowledgeAlert, autoCreateTicket,
  isInMaintenanceWindow, activeMaintenanceWindowId, isSuppressedByCorrelation, checkFlapping, triggerEscalation,
  evaluateAlertsV2, getActiveAlerts,
  // Exported so other services building a dynamic `snmp_metrics.<column>`
  // reference (e.g. automationService's remediation-rule engine) validate
  // against the SAME whitelist rather than maintaining a second, driftable one.
  SNMP_METRICS,
};
