// =============================================================================
// FireISP 5.0 — Diagnostic Engine Service (§21.4)
// =============================================================================
// Runs structured diagnostics for connectivity issues.
// All external service calls are wrapped in try/catch (returns status:'unknown' on error).
//
// DiagnosticResult = {
//   checks: [{ name, status:'ok'|'warning'|'error'|'unknown', detail }],
//   cause, recommendation, autoFixAvailable, confidence, escalate, escalationReason
// }
// =============================================================================
'use strict';
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'diagnosticEngineService' });

// ---------------------------------------------------------------------------
// Lazy service loaders — avoids hard coupling to optional services
// ---------------------------------------------------------------------------
function getRadiusService() {
  try { return require('./radiusService'); } catch { return null; }
}
function getWirelessService() {
  try { return require('./wirelessService'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a structured diagnostic for a customer's connectivity issue.
 *
 * @param {object} params
 * @param {number|string} params.orgId
 * @param {number|string} params.clientId
 * @param {number|string|null} params.conversationId
 * @param {string} params.symptom   - 'slow'|'no_internet'|'wifi'|'disconnects'|'slow_at_night'
 * @param {string} params.accessType - 'fiber'|'wireless'|'unknown'
 * @returns {Promise<DiagnosticResult>}
 */
async function runDiagnostic({ orgId, clientId, conversationId, symptom, accessType }) {
  let resolvedAccessType = accessType || 'unknown';

  // If access type is unknown, try to infer from RADIUS session
  if (resolvedAccessType === 'unknown') {
    try {
      const rs = getRadiusService();
      const session = rs ? await rs.getSessionByClientId(clientId, orgId) : null;
      resolvedAccessType = session ? 'fiber' : 'unknown';
    } catch {
      // keep 'unknown'
    }
  }

  let result;

  if (symptom === 'slow' && resolvedAccessType === 'fiber') {
    result = await _diagSlowFiber(clientId, orgId);
  } else if (symptom === 'slow' && resolvedAccessType === 'wireless') {
    result = await _diagSlowWireless(clientId, orgId);
  } else if (symptom === 'no_internet' && resolvedAccessType === 'fiber') {
    result = await _diagNoInternetFiber(clientId, orgId);
  } else if (symptom === 'no_internet' && resolvedAccessType === 'wireless') {
    result = await _diagNoInternetWireless(clientId, orgId);
  } else if (symptom === 'wifi') {
    result = await _diagWifi(clientId, orgId);
  } else if (symptom === 'disconnects') {
    result = await _diagDisconnects(clientId, orgId, resolvedAccessType);
  } else if (symptom === 'slow_at_night') {
    result = await _diagSlowAtNight(clientId, orgId, resolvedAccessType);
  } else {
    result = _genericResult(symptom);
  }

  // Persist to ai_diagnostic_runs
  await _storeRun(orgId, clientId, conversationId, resolvedAccessType, symptom, result);

  return result;
}

// ---------------------------------------------------------------------------
// Diagnostic handlers
// ---------------------------------------------------------------------------

async function _diagSlowFiber(clientId, orgId) {
  const checks = [];

  // Check 1: PPPoE/RADIUS session
  try {
    const rs = getRadiusService();
    const session = rs ? await rs.getSessionByClientId(clientId, orgId) : null;
    checks.push({
      name: 'pppoe_session',
      status: session ? 'ok' : 'warning',
      detail: session
        ? `Session active, IP: ${session.framedipaddress || 'unknown'}`
        : 'No active session found',
    });
  } catch {
    checks.push({ name: 'pppoe_session', status: 'unknown', detail: 'Service unavailable' });
  }

  // Check 2: ONU/ONT signal level from FTTH
  try {
    const [rows] = await db.query(
      `SELECT o.rx_power_dbm, o.tx_power_dbm, o.status
         FROM onu_devices o
         JOIN clients c ON c.id = ?
        WHERE o.organization_id = ? AND o.client_id = ?
        LIMIT 1`,
      [clientId, orgId, clientId],
    );
    if (rows.length === 0) {
      checks.push({ name: 'onu_signal', status: 'unknown', detail: 'ONU device not found' });
    } else {
      const onu = rows[0];
      const rxOk = onu.rx_power_dbm !== null && onu.rx_power_dbm > -27;
      checks.push({
        name: 'onu_signal',
        status: rxOk ? 'ok' : 'error',
        detail: `RX: ${onu.rx_power_dbm} dBm, TX: ${onu.tx_power_dbm} dBm, Status: ${onu.status}`,
      });
    }
  } catch {
    checks.push({ name: 'onu_signal', status: 'unknown', detail: 'Service unavailable' });
  }

  // Check 3: OLT port errors
  try {
    const [rows] = await db.query(
      `SELECT pp.client_count, pp.max_clients, pp.port_number
         FROM olt_pon_ports pp
         JOIN onu_devices od ON od.olt_port_id = pp.id
        WHERE od.client_id = ? AND pp.organization_id = ?
        LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length === 0) {
      checks.push({ name: 'olt_port', status: 'unknown', detail: 'OLT port not found' });
    } else {
      const port = rows[0];
      const overloaded = port.client_count > port.max_clients * 0.85;
      checks.push({
        name: 'olt_port',
        status: overloaded ? 'warning' : 'ok',
        detail: `Port ${port.port_number}: ${port.client_count}/${port.max_clients} clients`,
      });
    }
  } catch {
    checks.push({ name: 'olt_port', status: 'unknown', detail: 'OLT data unavailable' });
  }

  // Check 4: Active alerts for device
  try {
    const [alerts] = await db.query(
      `SELECT COUNT(*) AS cnt FROM alerts
        WHERE organization_id = ? AND status = 'active' AND severity IN ('critical','high')
          AND device_id IN (SELECT id FROM onu_devices WHERE client_id = ? LIMIT 5)`,
      [orgId, clientId],
    );
    const alertCount = alerts[0]?.cnt ?? 0;
    checks.push({
      name: 'active_alerts',
      status: alertCount > 0 ? 'warning' : 'ok',
      detail: `${alertCount} high/critical alerts on ONU device`,
    });
  } catch {
    checks.push({ name: 'active_alerts', status: 'unknown', detail: 'Alert service unavailable' });
  }

  // Check 5: Account suspension/quota
  try {
    const [rows] = await db.query(
      `SELECT c.status, c.data_cap_status
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
        WHERE cl.id = ? AND c.status = 'active'
        ORDER BY c.id DESC LIMIT 1`,
      [clientId],
    );
    if (rows.length > 0) {
      const contract = rows[0];
      const throttled = contract.data_cap_status === 'throttled';
      checks.push({
        name: 'account_status',
        status: throttled ? 'warning' : 'ok',
        detail: `Contract status: ${contract.status}, data cap: ${contract.data_cap_status || 'none'}`,
      });
    } else {
      checks.push({ name: 'account_status', status: 'unknown', detail: 'No active contract found' });
    }
  } catch {
    checks.push({ name: 'account_status', status: 'unknown', detail: 'Account data unavailable' });
  }

  return _buildResult(checks, 'Check fiber connections and ONT device. If signal is low, a technician visit may be required.');
}

async function _diagSlowWireless(clientId, orgId) {
  const checks = [];

  // Check 1: CPE signal level
  try {
    const [rows] = await db.query(
      'SELECT signal_dbm, noise_floor, ccq FROM cpe_devices WHERE client_id = ? AND organization_id = ? LIMIT 1',
      [clientId, orgId],
    );
    if (rows.length === 0) {
      checks.push({ name: 'cpe_signal', status: 'unknown', detail: 'CPE device not found' });
    } else {
      const cpe = rows[0];
      const signalOk = cpe.signal_dbm !== null && cpe.signal_dbm > -75;
      checks.push({
        name: 'cpe_signal',
        status: signalOk ? 'ok' : 'warning',
        detail: `Signal: ${cpe.signal_dbm} dBm, Noise: ${cpe.noise_floor} dBm, CCQ: ${cpe.ccq}%`,
      });
    }
  } catch {
    checks.push({ name: 'cpe_signal', status: 'unknown', detail: 'CPE service unavailable' });
  }

  // Check 2: AP channel congestion
  try {
    const ws = getWirelessService();
    if (ws && typeof ws.getInterferenceReport === 'function') {
      const report = await ws.getInterferenceReport(orgId);
      const hasInterference = report && report.length > 0;
      checks.push({
        name: 'channel_interference',
        status: hasInterference ? 'warning' : 'ok',
        detail: hasInterference ? `${report.length} interference events detected` : 'No interference detected',
      });
    } else {
      checks.push({ name: 'channel_interference', status: 'unknown', detail: 'Wireless service unavailable' });
    }
  } catch {
    checks.push({ name: 'channel_interference', status: 'unknown', detail: 'Wireless service unavailable' });
  }

  // Check 3: AP load
  try {
    const [rows] = await db.query(
      `SELECT ap.name, COUNT(cd.id) AS client_count
         FROM access_points ap
         JOIN cpe_devices cd ON cd.access_point_id = ap.id
        WHERE cd.client_id = ? AND ap.organization_id = ?
        GROUP BY ap.id, ap.name
        LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length > 0) {
      const ap = rows[0];
      const overloaded = ap.client_count > 40;
      checks.push({
        name: 'ap_load',
        status: overloaded ? 'warning' : 'ok',
        detail: `AP "${ap.name}" serving ${ap.client_count} clients`,
      });
    } else {
      checks.push({ name: 'ap_load', status: 'unknown', detail: 'AP not identified' });
    }
  } catch {
    checks.push({ name: 'ap_load', status: 'unknown', detail: 'AP data unavailable' });
  }

  // Check 4: RADIUS session
  try {
    const rs = getRadiusService();
    const session = rs ? await rs.getSessionByClientId(clientId, orgId) : null;
    checks.push({
      name: 'radius_session',
      status: session ? 'ok' : 'warning',
      detail: session ? `Session active since ${session.acctstarttime || 'unknown'}` : 'No active RADIUS session',
    });
  } catch {
    checks.push({ name: 'radius_session', status: 'unknown', detail: 'RADIUS service unavailable' });
  }

  // Check 5: Account quota
  try {
    const [rows] = await db.query(
      `SELECT data_cap_status FROM contracts
        WHERE client_id = ? AND status = 'active'
        ORDER BY id DESC LIMIT 1`,
      [clientId],
    );
    const throttled = rows[0]?.data_cap_status === 'throttled';
    checks.push({
      name: 'quota_status',
      status: throttled ? 'warning' : 'ok',
      detail: `Data cap status: ${rows[0]?.data_cap_status || 'normal'}`,
    });
  } catch {
    checks.push({ name: 'quota_status', status: 'unknown', detail: 'Contract data unavailable' });
  }

  return _buildResult(checks, 'Check CPE antenna alignment and AP channel. Consider channel change or CPE repositioning if signal is weak.');
}

async function _diagNoInternetFiber(clientId, orgId) {
  const checks = [];

  // Check 1: RADIUS/PPPoE session
  try {
    const rs = getRadiusService();
    const session = rs ? await rs.getSessionByClientId(clientId, orgId) : null;
    checks.push({
      name: 'pppoe_session',
      status: session ? 'ok' : 'error',
      detail: session ? `Active session, IP: ${session.framedipaddress}` : 'No PPPoE session — client not connected',
    });
  } catch {
    checks.push({ name: 'pppoe_session', status: 'unknown', detail: 'RADIUS service unavailable' });
  }

  // Check 2: ONU status
  try {
    const [rows] = await db.query(
      'SELECT status, rx_power_dbm FROM onu_devices WHERE client_id = ? AND organization_id = ? LIMIT 1',
      [clientId, orgId],
    );
    if (rows.length === 0) {
      checks.push({ name: 'onu_status', status: 'unknown', detail: 'ONU not found' });
    } else {
      const onu = rows[0];
      const offline = onu.status !== 'online';
      checks.push({
        name: 'onu_status',
        status: offline ? 'error' : 'ok',
        detail: `ONU status: ${onu.status}, RX: ${onu.rx_power_dbm} dBm`,
      });
    }
  } catch {
    checks.push({ name: 'onu_status', status: 'unknown', detail: 'ONU data unavailable' });
  }

  // Check 3: Account suspension
  try {
    const [rows] = await db.query(
      `SELECT c.status, cl.suspended
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
        WHERE cl.id = ? ORDER BY c.id DESC LIMIT 1`,
      [clientId],
    );
    if (rows.length > 0) {
      const suspended = rows[0].suspended === 1 || rows[0].status === 'suspended';
      checks.push({
        name: 'account_suspension',
        status: suspended ? 'error' : 'ok',
        detail: suspended ? 'Account is suspended — likely billing issue' : 'Account active',
      });
    } else {
      checks.push({ name: 'account_suspension', status: 'unknown', detail: 'Account data unavailable' });
    }
  } catch {
    checks.push({ name: 'account_suspension', status: 'unknown', detail: 'Account lookup failed' });
  }

  // Check 4: OLT hardware alerts
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM alerts
        WHERE organization_id = ? AND status = 'active' AND alert_type = 'olt_hardware_failure'`,
      [orgId],
    );
    const oltFailing = (rows[0]?.cnt ?? 0) > 0;
    checks.push({
      name: 'olt_hardware',
      status: oltFailing ? 'error' : 'ok',
      detail: oltFailing ? 'OLT hardware failure alert active — mass outage possible' : 'No OLT hardware failures',
    });
  } catch {
    checks.push({ name: 'olt_hardware', status: 'unknown', detail: 'Alert data unavailable' });
  }

  // Check 5: Fiber splice alert
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM alerts
        WHERE organization_id = ? AND status = 'active' AND alert_type LIKE '%fiber%'`,
      [orgId],
    );
    const fiberIssue = (rows[0]?.cnt ?? 0) > 0;
    checks.push({
      name: 'fiber_splice',
      status: fiberIssue ? 'error' : 'ok',
      detail: fiberIssue ? 'Fiber infrastructure alert active' : 'No fiber alerts',
    });
  } catch {
    checks.push({ name: 'fiber_splice', status: 'unknown', detail: 'Alert data unavailable' });
  }

  return _buildResult(checks, 'Verify ONT device is powered on. Check for service outages in your area. If account is suspended, review billing status.');
}

async function _diagNoInternetWireless(clientId, orgId) {
  const checks = [];

  // Check 1: RADIUS session
  try {
    const rs = getRadiusService();
    const session = rs ? await rs.getSessionByClientId(clientId, orgId) : null;
    checks.push({
      name: 'radius_session',
      status: session ? 'ok' : 'error',
      detail: session ? `Session active, IP: ${session.framedipaddress}` : 'No active session',
    });
  } catch {
    checks.push({ name: 'radius_session', status: 'unknown', detail: 'RADIUS service unavailable' });
  }

  // Check 2: CPE status
  try {
    const [rows] = await db.query(
      'SELECT status, signal_dbm FROM cpe_devices WHERE client_id = ? AND organization_id = ? LIMIT 1',
      [clientId, orgId],
    );
    if (rows.length === 0) {
      checks.push({ name: 'cpe_status', status: 'unknown', detail: 'CPE not found' });
    } else {
      const cpe = rows[0];
      const offline = cpe.status !== 'online';
      checks.push({
        name: 'cpe_status',
        status: offline ? 'error' : 'ok',
        detail: `CPE status: ${cpe.status}, Signal: ${cpe.signal_dbm} dBm`,
      });
    }
  } catch {
    checks.push({ name: 'cpe_status', status: 'unknown', detail: 'CPE data unavailable' });
  }

  // Check 3: AP status
  try {
    const [rows] = await db.query(
      `SELECT ap.name, ap.status
         FROM access_points ap
         JOIN cpe_devices cd ON cd.access_point_id = ap.id
        WHERE cd.client_id = ? AND ap.organization_id = ?
        LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length > 0) {
      const ap = rows[0];
      const apDown = ap.status !== 'active';
      checks.push({
        name: 'ap_status',
        status: apDown ? 'error' : 'ok',
        detail: `AP "${ap.name}" status: ${ap.status}`,
      });
    } else {
      checks.push({ name: 'ap_status', status: 'unknown', detail: 'AP not identified' });
    }
  } catch {
    checks.push({ name: 'ap_status', status: 'unknown', detail: 'AP data unavailable' });
  }

  // Check 4: Account suspension
  try {
    const [rows] = await db.query(
      'SELECT suspended FROM clients WHERE id = ?',
      [clientId],
    );
    const suspended = rows[0]?.suspended === 1;
    checks.push({
      name: 'account_suspension',
      status: suspended ? 'error' : 'ok',
      detail: suspended ? 'Account suspended' : 'Account active',
    });
  } catch {
    checks.push({ name: 'account_suspension', status: 'unknown', detail: 'Account data unavailable' });
  }

  // Check 5: Area alerts
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM alerts
        WHERE organization_id = ? AND status = 'active' AND severity = 'critical'`,
      [orgId],
    );
    const hasOutage = (rows[0]?.cnt ?? 0) > 0;
    checks.push({
      name: 'area_outage',
      status: hasOutage ? 'warning' : 'ok',
      detail: hasOutage ? 'Critical alerts active in your area — possible service outage' : 'No area-wide outage detected',
    });
  } catch {
    checks.push({ name: 'area_outage', status: 'unknown', detail: 'Alert data unavailable' });
  }

  return _buildResult(checks, 'Verify CPE antenna is powered and aligned. Check if area outage is affecting service. If account is suspended, resolve billing issue.');
}

async function _diagWifi(clientId, orgId) {
  const checks = [];

  // Check 1: Customer router reachability via ping (simulated from context)
  checks.push({
    name: 'router_reachability',
    status: 'unknown',
    detail: 'Remote ping to customer router not available — advise client to check 192.168.1.1',
  });

  // Check 2: DHCP lease check (via RADIUS)
  try {
    const rs = getRadiusService();
    const session = rs ? await rs.getSessionByClientId(clientId, orgId) : null;
    checks.push({
      name: 'dhcp_session',
      status: session ? 'ok' : 'warning',
      detail: session ? 'Internet session active — issue is local WiFi' : 'No internet session detected',
    });
  } catch {
    checks.push({ name: 'dhcp_session', status: 'unknown', detail: 'RADIUS service unavailable' });
  }

  // Check 3: Check for CPE model (some have known WiFi bugs)
  try {
    const [rows] = await db.query(
      'SELECT model, firmware_version FROM cpe_devices WHERE client_id = ? AND organization_id = ? LIMIT 1',
      [clientId, orgId],
    );
    if (rows.length > 0) {
      checks.push({
        name: 'cpe_model',
        status: 'ok',
        detail: `CPE model: ${rows[0].model}, Firmware: ${rows[0].firmware_version || 'unknown'}`,
      });
    } else {
      checks.push({ name: 'cpe_model', status: 'unknown', detail: 'CPE not found' });
    }
  } catch {
    checks.push({ name: 'cpe_model', status: 'unknown', detail: 'CPE data unavailable' });
  }

  // Check 4: Recent tickets for same issue
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM tickets
        WHERE client_id = ? AND subject LIKE '%wifi%' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [clientId],
    );
    const recentWifiTickets = rows[0]?.cnt ?? 0;
    checks.push({
      name: 'recurring_wifi_issue',
      status: recentWifiTickets > 2 ? 'warning' : 'ok',
      detail: `${recentWifiTickets} WiFi-related ticket(s) in last 30 days`,
    });
  } catch {
    checks.push({ name: 'recurring_wifi_issue', status: 'unknown', detail: 'Ticket history unavailable' });
  }

  return _buildResult(
    checks,
    'Restart your router by unplugging it for 30 seconds. If the issue persists, try connecting via Ethernet cable to check if the problem is the router or the Internet connection.',
  );
}

async function _diagDisconnects(clientId, orgId, accessType) {
  const checks = [];

  // Check 1: RADIUS disconnect history
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt
         FROM connection_logs
        WHERE client_id = ? AND event_type = 'stop'
          AND event_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [clientId],
    );
    const disconnectCount = rows[0]?.cnt ?? 0;
    checks.push({
      name: 'disconnect_frequency',
      status: disconnectCount > 10 ? 'error' : disconnectCount > 3 ? 'warning' : 'ok',
      detail: `${disconnectCount} disconnection events in last 7 days`,
    });
  } catch {
    checks.push({ name: 'disconnect_frequency', status: 'unknown', detail: 'Connection log unavailable' });
  }

  // Check 2: CPE/ONU signal stability
  if (accessType === 'wireless') {
    try {
      const [rows] = await db.query(
        'SELECT signal_dbm, noise_floor FROM cpe_devices WHERE client_id = ? AND organization_id = ? LIMIT 1',
        [clientId, orgId],
      );
      if (rows.length > 0) {
        const snr = (rows[0].signal_dbm || 0) - (rows[0].noise_floor || -100);
        checks.push({
          name: 'signal_stability',
          status: snr < 15 ? 'warning' : 'ok',
          detail: `Signal: ${rows[0].signal_dbm} dBm, SNR: ${snr} dB`,
        });
      } else {
        checks.push({ name: 'signal_stability', status: 'unknown', detail: 'CPE not found' });
      }
    } catch {
      checks.push({ name: 'signal_stability', status: 'unknown', detail: 'CPE data unavailable' });
    }
  } else {
    try {
      const [rows] = await db.query(
        'SELECT rx_power_dbm, status FROM onu_devices WHERE client_id = ? AND organization_id = ? LIMIT 1',
        [clientId, orgId],
      );
      if (rows.length > 0) {
        const rxOk = rows[0].rx_power_dbm !== null && rows[0].rx_power_dbm > -27;
        checks.push({
          name: 'onu_signal_stability',
          status: rxOk ? 'ok' : 'warning',
          detail: `ONU RX: ${rows[0].rx_power_dbm} dBm, Status: ${rows[0].status}`,
        });
      } else {
        checks.push({ name: 'onu_signal_stability', status: 'unknown', detail: 'ONU not found' });
      }
    } catch {
      checks.push({ name: 'onu_signal_stability', status: 'unknown', detail: 'ONU data unavailable' });
    }
  }

  // Check 3: Power fluctuation / UPS alerts
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM alerts
        WHERE organization_id = ? AND status = 'active'
          AND (alert_type LIKE '%power%' OR alert_type LIKE '%ups%')`,
      [orgId],
    );
    const powerAlerts = rows[0]?.cnt ?? 0;
    checks.push({
      name: 'power_alerts',
      status: powerAlerts > 0 ? 'warning' : 'ok',
      detail: `${powerAlerts} power-related alerts active`,
    });
  } catch {
    checks.push({ name: 'power_alerts', status: 'unknown', detail: 'Alert data unavailable' });
  }

  // Check 4: Router/CPE reboots (firmware)
  try {
    const [rows] = await db.query(
      `SELECT firmware_version, last_seen FROM cpe_devices
        WHERE client_id = ? AND organization_id = ? LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length > 0) {
      const stale = rows[0].last_seen && (Date.now() - new Date(rows[0].last_seen).getTime()) > 3600000;
      checks.push({
        name: 'cpe_reachability',
        status: stale ? 'warning' : 'ok',
        detail: `Last seen: ${rows[0].last_seen || 'unknown'}, Firmware: ${rows[0].firmware_version || 'unknown'}`,
      });
    } else {
      checks.push({ name: 'cpe_reachability', status: 'unknown', detail: 'CPE not found' });
    }
  } catch {
    checks.push({ name: 'cpe_reachability', status: 'unknown', detail: 'CPE data unavailable' });
  }

  return _buildResult(
    checks,
    'Frequent disconnects may be caused by signal instability, power issues, or faulty equipment. Consider a site visit if disconnects are frequent.',
  );
}

async function _diagSlowAtNight(clientId, orgId, accessType) {
  const checks = [];

  // Check 1: PON port utilization at peak hours
  try {
    const [rows] = await db.query(
      `SELECT pp.client_count, pp.max_clients, pp.port_number
         FROM olt_pon_ports pp
         JOIN onu_devices od ON od.olt_port_id = pp.id
        WHERE od.client_id = ? AND pp.organization_id = ?
        LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length > 0) {
      const util = rows[0].client_count / (rows[0].max_clients || 1);
      checks.push({
        name: 'pon_utilization',
        status: util > 0.8 ? 'warning' : 'ok',
        detail: `PON port ${rows[0].port_number}: ${rows[0].client_count}/${rows[0].max_clients} clients (${Math.round(util * 100)}% utilization)`,
      });
    } else {
      checks.push({ name: 'pon_utilization', status: 'unknown', detail: 'PON data unavailable' });
    }
  } catch {
    checks.push({ name: 'pon_utilization', status: 'unknown', detail: 'PON data unavailable' });
  }

  // Check 2: AP client density (wireless)
  if (accessType === 'wireless') {
    try {
      const [rows] = await db.query(
        `SELECT ap.name, COUNT(cd.id) AS cnt
           FROM access_points ap
           JOIN cpe_devices cd ON cd.access_point_id = ap.id
          WHERE cd.client_id = ? AND ap.organization_id = ?
          GROUP BY ap.id, ap.name LIMIT 1`,
        [clientId, orgId],
      );
      if (rows.length > 0) {
        const overloaded = rows[0].cnt > 30;
        checks.push({
          name: 'ap_density',
          status: overloaded ? 'warning' : 'ok',
          detail: `AP "${rows[0].name}" serves ${rows[0].cnt} clients — congestion likely at peak hours`,
        });
      } else {
        checks.push({ name: 'ap_density', status: 'unknown', detail: 'AP data unavailable' });
      }
    } catch {
      checks.push({ name: 'ap_density', status: 'unknown', detail: 'AP data unavailable' });
    }
  }

  // Check 3: QoS policy applied
  try {
    const [rows] = await db.query(
      `SELECT qp.name, qp.priority_level
         FROM qos_policies qp
         JOIN contracts c ON c.qos_policy_id = qp.id
         JOIN clients cl ON cl.id = c.client_id
        WHERE cl.id = ? LIMIT 1`,
      [clientId],
    );
    if (rows.length > 0) {
      checks.push({
        name: 'qos_policy',
        status: 'ok',
        detail: `QoS policy: ${rows[0].name}, priority: ${rows[0].priority_level}`,
      });
    } else {
      checks.push({ name: 'qos_policy', status: 'warning', detail: 'No QoS policy assigned — may experience peak-hour congestion' });
    }
  } catch {
    checks.push({ name: 'qos_policy', status: 'unknown', detail: 'QoS data unavailable' });
  }

  // Check 4: Data cap throttling
  try {
    const [rows] = await db.query(
      `SELECT data_cap_status, data_used_gb, p.data_cap_gb
         FROM contracts c JOIN plans p ON p.id = c.plan_id
        WHERE c.client_id = ? AND c.status = 'active'
        ORDER BY c.id DESC LIMIT 1`,
      [clientId],
    );
    if (rows.length > 0) {
      const r = rows[0];
      const throttled = r.data_cap_status === 'throttled';
      checks.push({
        name: 'data_throttle',
        status: throttled ? 'warning' : 'ok',
        detail: `Used: ${r.data_used_gb || 0} GB / Cap: ${r.data_cap_gb || 'unlimited'} GB — ${r.data_cap_status || 'normal'}`,
      });
    } else {
      checks.push({ name: 'data_throttle', status: 'unknown', detail: 'Contract data unavailable' });
    }
  } catch {
    checks.push({ name: 'data_throttle', status: 'unknown', detail: 'Contract data unavailable' });
  }

  return _buildResult(
    checks,
    'Slow speeds at night are typically caused by network congestion at peak hours. If your QoS priority is low or PON utilization is high, a plan upgrade may help.',
  );
}

function _genericResult(symptom) {
  return {
    checks: [{
      name: 'generic_check',
      status: 'unknown',
      detail: `No specific diagnostic available for symptom: ${symptom}`,
    }],
    cause: 'Unable to determine specific cause — manual review required',
    recommendation: 'Please contact technical support for assistance.',
    autoFixAvailable: 0,
    confidence: 0,
    escalate: false,
    escalationReason: null,
  };
}

// ---------------------------------------------------------------------------
// Helper: build DiagnosticResult from checks array
// ---------------------------------------------------------------------------
function _buildResult(checks, defaultRecommendation) {
  const errorChecks = checks.filter(c => c.status === 'error');
  const knownChecks = checks.filter(c => c.status !== 'unknown').length;
  const confidence = checks.length > 0 ? knownChecks / checks.length : 0;

  // Escalate if physical infrastructure issues detected
  const escalateNames = new Set(['olt_hardware', 'onu_replacement', 'fiber_splice']);
  const escalate = errorChecks.some(c => escalateNames.has(c.name))
    || (errorChecks.some(c => c.name === 'onu_signal') && errorChecks.some(c => c.name === 'onu_status'));

  return {
    checks,
    cause: errorChecks.length > 0
      ? `Issues detected: ${errorChecks.map(c => c.name).join(', ')}`
      : 'No critical issues detected',
    recommendation: defaultRecommendation,
    autoFixAvailable: 0,
    confidence: Math.round(confidence * 100) / 100,
    escalate,
    escalationReason: escalate ? 'Physical infrastructure issue detected — technician required' : null,
  };
}

// ---------------------------------------------------------------------------
// Store diagnostic run in DB
// ---------------------------------------------------------------------------
async function _storeRun(orgId, clientId, conversationId, accessType, symptom, result) {
  try {
    await db.query(
      `INSERT INTO ai_diagnostic_runs
         (organization_id, client_id, conversation_id, access_type, symptom,
          checks_run, cause, recommendation, auto_fix_available,
          confidence, escalate, escalation_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        orgId,
        clientId,
        conversationId || null,
        accessType,
        symptom,
        JSON.stringify(result.checks),
        result.cause,
        result.recommendation,
        result.autoFixAvailable ? 1 : 0,
        result.confidence,
        result.escalate ? 1 : 0,
        result.escalationReason || null,
      ],
    );
  } catch (err) {
    logger.warn({ err }, 'diagnosticEngine: failed to persist diagnostic run');
  }
}

module.exports = { runDiagnostic };
