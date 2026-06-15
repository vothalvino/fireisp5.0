// =============================================================================
// FireISP 5.0 — NOC AI Service (§21.11)
// =============================================================================
// AI-powered insights for Network Operations Center staff.
// All LLM calls via llmProviderService; deterministic fallback when no provider.
// =============================================================================
'use strict';
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'nocAiService' });
const { NotFoundError } = require('../utils/errors');

// ---------------------------------------------------------------------------
// Lazy LLM loader
// ---------------------------------------------------------------------------
function getLlmService() {
  try { return require('./llmProviderService'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Runbook templates (deterministic)
// ---------------------------------------------------------------------------
const RUNBOOK_TEMPLATES = {
  olt_hardware_failure: [
    '1. Verify OLT hardware LEDs and physical connections.',
    '2. SSH into OLT and run: show chassis (or equivalent vendor command).',
    '3. Check power supply status and fan tray.',
    '4. Review syslog for hardware error messages.',
    '5. If hardware fault confirmed, open RMA with vendor.',
    '6. Activate backup OLT if available; reroute traffic.',
    '7. Notify affected subscribers of outage and ETA.',
  ].join('\n'),
  high_latency: [
    '1. Identify affected network segment using traceroute.',
    '2. Check link utilization on upstream interfaces.',
    '3. Review QoS queuing statistics for congestion.',
    '4. Check for routing loops: review BGP/OSPF neighbor table.',
    '5. If transit provider issue, open ticket with upstream carrier.',
    '6. Consider traffic shaping or burst buffering as temporary fix.',
  ].join('\n'),
  packet_loss: [
    '1. Confirm packet loss with continuous ping to multiple targets.',
    '2. Check interface error counters (CRC, input/output errors).',
    '3. If wireless: verify signal levels and interference on affected AP.',
    '4. If fiber: check SFP transceivers and fiber patch cables.',
    '5. Review SNMP interface MIB for error trends.',
    '6. Schedule preventive maintenance if errors are intermittent.',
  ].join('\n'),
  power_outage: [
    '1. Verify UPS battery level and runtime.',
    '2. Check generator fuel level and auto-start status.',
    '3. Identify which segments are affected.',
    '4. Prioritize sites with most subscribers or critical infrastructure.',
    '5. Coordinate with field team for manual intervention.',
    '6. Update subscribers via push notification or SMS.',
  ].join('\n'),
  default: [
    '1. Acknowledge the alert and assign to on-call engineer.',
    '2. Gather affected device information (model, location, uptime).',
    '3. Review recent configuration changes (last 24h).',
    '4. Check vendor knowledge base for known issues.',
    '5. Escalate to tier 2 if not resolved within 30 minutes.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Explain an alert using LLM or deterministic template.
 *
 * @param {number|string} orgId
 * @param {number|string} alertId
 * @param {number|string|null} providerId
 * @returns {Promise<object>}
 */
async function explainAlert(orgId, alertId, providerId) {
  const [alertRows] = await db.query(
    'SELECT * FROM alerts WHERE id = ? AND organization_id = ?',
    [alertId, orgId],
  );
  if (alertRows.length === 0) throw new NotFoundError('Alert');

  const alert = alertRows[0];
  const context = {
    alertType: alert.alert_type,
    severity: alert.severity,
    message: alert.message,
    deviceId: alert.device_id,
  };

  let summary;
  let recommendation;

  if (providerId) {
    const llm = getLlmService();
    if (llm && typeof llm.chat === 'function') {
      try {
        const result = await llm.chat({
          providerId,
          messages: [
            {
              role: 'system',
              content: 'You are an expert NOC engineer. Explain network alerts in clear, concise language for ISP operations staff. Include likely causes and immediate actions.',
            },
            {
              role: 'user',
              content: `Alert type: ${context.alertType}\nSeverity: ${context.severity}\nMessage: ${context.message}\nDevice: ${context.deviceId || 'unknown'}\n\nProvide a brief explanation and recommended action.`,
            },
          ],
        });
        summary = result.text;
        recommendation = null; // Embedded in LLM response
      } catch (err) {
        logger.warn({ err }, 'nocAiService: LLM call failed — using deterministic fallback');
        ({ summary, recommendation } = _deterministicAlertExplain(context));
      }
    } else {
      ({ summary, recommendation } = _deterministicAlertExplain(context));
    }
  } else {
    ({ summary, recommendation } = _deterministicAlertExplain(context));
  }

  return _insertInsight({
    orgId,
    type: 'alert_explanation',
    alertId: alert.id,
    deviceId: alert.device_id,
    affectedSubscribers: 0,
    summary,
    recommendation,
    confidence: providerId ? 0.85 : 0.7,
    providerId: providerId || null,
  });
}

function _deterministicAlertExplain(context) {
  const typeMap = {
    olt_hardware_failure: `OLT hardware failure detected on device ${context.deviceId || 'unknown'}. This may cause service disruption for multiple subscribers connected to this device.`,
    high_latency: `High latency detected (${context.message || 'threshold exceeded'}). Likely caused by link congestion, routing issue, or upstream provider degradation.`,
    packet_loss: `Packet loss detected on device ${context.deviceId || 'unknown'}. May indicate physical layer issues (fiber, SFP, cables) or severe congestion.`,
    power_outage: `Power event detected on device ${context.deviceId || 'unknown'}. UPS may be running on battery. Check generator and grid power status.`,
  };

  const summary = typeMap[context.alertType]
    ?? `Alert of type "${context.alertType}" with severity "${context.severity}": ${context.message || 'No details available.'}`;

  const recommendation = RUNBOOK_TEMPLATES[context.alertType] ?? RUNBOOK_TEMPLATES.default;

  return { summary, recommendation };
}

// ---------------------------------------------------------------------------

/**
 * Identify PON ports approaching capacity.
 *
 * @param {number|string} orgId
 * @param {number|string|null} providerId
 * @returns {Promise<object>}
 */
async function capacityWarning(orgId, providerId) {
  let overloadedPorts = [];
  try {
    const [rows] = await db.query(
      `SELECT device_id, port_number, client_count, max_clients
         FROM olt_pon_ports
        WHERE organization_id = ? AND client_count > max_clients * 0.8`,
      [orgId],
    );
    overloadedPorts = rows;
  } catch {
    // Table may not exist yet — graceful degradation
  }

  const summary = overloadedPorts.length > 0
    ? `${overloadedPorts.length} PON port(s) at >80% capacity: ${overloadedPorts.map(p => `Port ${p.port_number} (${p.client_count}/${p.max_clients} clients)`).join(', ')}.`
    : 'All PON ports are within normal capacity thresholds.';

  const recommendation = overloadedPorts.length > 0
    ? 'Consider load balancing ONUs across underutilized ports or provisioning additional PON capacity.'
    : null;

  return _insertInsight({
    orgId,
    type: 'capacity_warning',
    alertId: null,
    deviceId: null,
    affectedSubscribers: overloadedPorts.reduce((sum, p) => sum + (p.client_count || 0), 0),
    summary,
    recommendation,
    confidence: 0.9,
    providerId: providerId || null,
  });
}

// ---------------------------------------------------------------------------

/**
 * Detect RF interference from wireless device noise floor data.
 *
 * @param {number|string} orgId
 * @param {number|string|null} providerId
 * @returns {Promise<object>}
 */
async function detectInterference(orgId, providerId) {
  let affectedDevices = [];
  try {
    const [rows] = await db.query(
      `SELECT device_id, channel, noise_floor
         FROM wireless_devices
        WHERE organization_id = ? AND noise_floor > -70`,
      [orgId],
    );
    affectedDevices = rows;
  } catch {
    // wireless_devices may not exist
  }

  const summary = affectedDevices.length > 0
    ? `${affectedDevices.length} wireless device(s) show elevated noise floor (>-70 dBm): ${affectedDevices.map(d => `Device ${d.device_id} Ch${d.channel} (${d.noise_floor} dBm)`).join(', ')}.`
    : 'No significant RF interference detected.';

  const recommendation = affectedDevices.length > 0
    ? 'Consider channel change or frequency reuse planning for affected APs. Conduct site survey if interference persists.'
    : null;

  return _insertInsight({
    orgId,
    type: 'interference_detection',
    alertId: null,
    deviceId: null,
    affectedSubscribers: affectedDevices.length,
    summary,
    recommendation,
    confidence: 0.75,
    providerId: providerId || null,
  });
}

// ---------------------------------------------------------------------------

/**
 * Detect CPE devices with poor signal suggesting alignment drift.
 *
 * @param {number|string} orgId
 * @param {number|string|null} providerId
 * @returns {Promise<object>}
 */
async function alignmentDrift(orgId, providerId) {
  let driftedCpes = [];
  try {
    const [rows] = await db.query(
      `SELECT id, name, signal_dbm
         FROM cpe_devices
        WHERE organization_id = ? AND signal_dbm < -80`,
      [orgId],
    );
    driftedCpes = rows;
  } catch {
    // cpe_devices may not exist
  }

  const summary = driftedCpes.length > 0
    ? `${driftedCpes.length} CPE device(s) with signal below -80 dBm (possible alignment drift): ${driftedCpes.slice(0, 5).map(c => `${c.name || c.id} (${c.signal_dbm} dBm)`).join(', ')}${driftedCpes.length > 5 ? '...' : ''}.`
    : 'No CPE devices with significant alignment drift detected.';

  const recommendation = driftedCpes.length > 0
    ? 'Schedule field visits to re-align CPE antennas. Check for new obstructions (trees, buildings) near customer premises.'
    : null;

  return _insertInsight({
    orgId,
    type: 'alignment_drift',
    alertId: null,
    deviceId: null,
    affectedSubscribers: driftedCpes.length,
    summary,
    recommendation,
    confidence: 0.8,
    providerId: providerId || null,
  });
}

// ---------------------------------------------------------------------------

/**
 * Generate a shift summary for NOC handover.
 *
 * @param {number|string} orgId
 * @param {number|string|null} providerId
 * @returns {Promise<object>}
 */
async function shiftSummary(orgId, providerId) {
  let openTickets = 0;
  let activeAlerts = 0;
  let escalatedConvs = 0;

  try {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM tickets WHERE organization_id = ? AND status = ?',
      [orgId, 'open'],
    );
    openTickets = rows[0]?.cnt ?? 0;
  } catch { /* ignore */ }

  try {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM alerts WHERE organization_id = ? AND status = ?',
      [orgId, 'active'],
    );
    activeAlerts = rows[0]?.cnt ?? 0;
  } catch { /* ignore */ }

  try {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM support_conversations WHERE organization_id = ? AND status = ?',
      [orgId, 'escalated'],
    );
    escalatedConvs = rows[0]?.cnt ?? 0;
  } catch { /* ignore */ }

  let summary;

  if (providerId) {
    const llm = getLlmService();
    if (llm && typeof llm.chat === 'function') {
      try {
        const result = await llm.chat({
          providerId,
          messages: [
            {
              role: 'system',
              content: 'You are an NOC operations assistant. Generate concise shift handover summaries for ISP network operations center staff.',
            },
            {
              role: 'user',
              content: `Shift summary data:\n- Open tickets: ${openTickets}\n- Active alerts: ${activeAlerts}\n- Escalated AI conversations: ${escalatedConvs}\n\nGenerate a brief handover note.`,
            },
          ],
        });
        summary = result.text;
      } catch {
        summary = _buildDeterministicShiftSummary(openTickets, activeAlerts, escalatedConvs);
      }
    } else {
      summary = _buildDeterministicShiftSummary(openTickets, activeAlerts, escalatedConvs);
    }
  } else {
    summary = _buildDeterministicShiftSummary(openTickets, activeAlerts, escalatedConvs);
  }

  return _insertInsight({
    orgId,
    type: 'shift_summary',
    alertId: null,
    deviceId: null,
    affectedSubscribers: 0,
    summary,
    recommendation: openTickets > 10 || activeAlerts > 5 ? 'High activity — ensure incoming shift is fully briefed before handover.' : null,
    confidence: 0.95,
    providerId: providerId || null,
  });
}

function _buildDeterministicShiftSummary(openTickets, activeAlerts, escalatedConvs) {
  const status = (activeAlerts === 0 && openTickets < 5)
    ? 'Network status is nominal.'
    : `Attention required: ${activeAlerts} active alert(s) and ${openTickets} open ticket(s).`;

  return `NOC Shift Summary: ${status} ${openTickets} open ticket(s), ${activeAlerts} active alert(s), ${escalatedConvs} escalated AI support conversation(s) pending human review.`;
}

// ---------------------------------------------------------------------------

/**
 * Suggest runbook steps for a given alert type.
 *
 * @param {number|string} orgId
 * @param {string} alertType
 * @param {number|string|null} providerId
 * @returns {Promise<object>}
 */
async function runbookSuggestion(orgId, alertType, providerId) {
  const template = RUNBOOK_TEMPLATES[alertType] ?? RUNBOOK_TEMPLATES.default;
  let summary = template;

  if (providerId) {
    const llm = getLlmService();
    if (llm && typeof llm.chat === 'function') {
      try {
        const result = await llm.chat({
          providerId,
          messages: [
            {
              role: 'system',
              content: 'You are an expert ISP network engineer. Provide step-by-step runbook guidance for network operations incidents.',
            },
            {
              role: 'user',
              content: `Alert type: ${alertType}\n\nBase runbook:\n${template}\n\nEnhance with additional troubleshooting detail for ISP operations.`,
            },
          ],
        });
        summary = result.text || template;
      } catch {
        summary = template;
      }
    }
  }

  return _insertInsight({
    orgId,
    type: 'runbook_suggestion',
    alertId: null,
    deviceId: null,
    affectedSubscribers: 0,
    summary,
    recommendation: `Apply the above runbook for "${alertType}" incidents. Update the template after resolution with any new findings.`,
    confidence: 0.9,
    providerId: providerId || null,
  });
}

// ---------------------------------------------------------------------------

/**
 * List recent NOC AI insights for an organization.
 *
 * @param {number|string} orgId
 * @param {object} filters - limit (default 50)
 * @returns {Promise<object[]>}
 */
async function listInsights(orgId, filters = {}) {
  const safeLimit = Math.max(1, parseInt(filters.limit, 10) || 50);
  const [rows] = await db.query(
    `SELECT * FROM noc_ai_insights
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ${safeLimit}`,
    [orgId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function _insertInsight(insight) {
  try {
    const [result] = await db.query(
      `INSERT INTO noc_ai_insights
         (organization_id, insight_type, alert_id, device_id,
          affected_subscribers, summary, recommendation, confidence, provider_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        insight.orgId,
        insight.type,
        insight.alertId || null,
        insight.deviceId || null,
        insight.affectedSubscribers || 0,
        insight.summary,
        insight.recommendation || null,
        insight.confidence || 0.8,
        insight.providerId || null,
      ],
    );
    return { id: result.insertId, ...insight };
  } catch (err) {
    logger.error({ err }, 'nocAiService: failed to persist insight');
    throw err;
  }
}

module.exports = {
  explainAlert,
  capacityWarning,
  detectInterference,
  alignmentDrift,
  shiftSummary,
  runbookSuggestion,
  listInsights,
};
