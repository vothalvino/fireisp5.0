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
// Device-resolution helpers
// ---------------------------------------------------------------------------
// Every FTTH/wireless monitoring table (onu_details, onu_optical_metrics,
// wireless_client_sessions) is keyed on `devices.id` — never on
// clients.id/contracts.id directly. cpe_devices.device_id is the bridge:
// cpe_devices.contract_id -> contracts.client_id -> clients.id on one side,
// cpe_devices.device_id -> devices.id on the other. The checks below used to
// query nonexistent tables (`onu_devices`, `access_points`, `alerts` [real:
// alert_events], `olt_pon_ports` [real: olt_ports]) with a nonexistent
// `client_id` column on cpe_devices/onu tables — every one of them threw,
// was caught by the surrounding try/catch (per this file's documented
// contract), and silently reported status:'unknown' forever.
//
// item 8 of the second adversarial review: `devices.type` distinguishes
// `onu` from `indoor_cpe`/`outdoor_cpe` — cpe_devices.device_id (see
// `_resolveCpeDeviceId` below) is documented on the schema itself as "FK to
// devices table (indoor_cpe/outdoor_cpe types)", i.e. the TR-069 home
// router/CPE, never the ONU. A single resolver used for BOTH used to hand
// fiber clients their router's devices.id and then join it against
// onu_details (which is keyed on devices of type='onu') — that join always
// returns nothing, so every FTTH-specific check (onu_signal, olt_port,
// active_alerts, pon_utilization) silently read 'unknown' forever, even for
// a perfectly healthy, actively-monitored ONU. `devices` carries client_id
// directly for both device kinds, so each gets its own resolver querying the
// right `type`.
//
// devices.client_id was, until recently, unsettable through the API (no
// validation-schema field, no fillable entry), so the "direct" lookup below
// was permanently dead in practice — every ONU could only ever be reached
// through the cpe_devices bridge, and `_resolveCpeDeviceId` never checked
// `devices.type` on the far end of that bridge. Since cpe_devices.device_id
// has no server-side type guard, nothing stopped an ONU from being linked
// through the CPE bridge and misclassified as wireless (or vice versa).
// `_resolveOnuDeviceId` now falls back to the same bridge (filtered to
// `type = 'onu'`) so devices onboarded before client_id was settable still
// resolve, and `_resolveCpeDeviceId` now joins back to `devices` and
// restricts to the two real CPE type values so it can never return an ONU's
// device id — the two resolvers are mutually exclusive by `devices.type`,
// not just by which table happened to answer first.

/**
 * Resolve the `devices.id` (type='onu') monitored for a client's fiber
 * service. Returns null if there is no monitored ONU for this client.
 */
async function _resolveOnuDeviceId(clientId, orgId) {
  const [direct] = await db.query(
    `SELECT id FROM devices
      WHERE client_id = ? AND organization_id = ? AND type = 'onu' AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [clientId, orgId],
  );
  if (direct[0]?.id) return direct[0].id;

  const [bridged] = await db.query(
    `SELECT d.id
       FROM cpe_devices cd
       JOIN contracts c ON c.id = cd.contract_id
       JOIN devices d ON d.id = cd.device_id
      WHERE c.client_id = ? AND c.organization_id = ? AND c.status = 'active'
        AND cd.deleted_at IS NULL AND cd.device_id IS NOT NULL
        AND d.type = 'onu' AND d.deleted_at IS NULL
      ORDER BY cd.id DESC LIMIT 1`,
    [clientId, orgId],
  );
  return bridged[0]?.id ?? null;
}

/**
 * Resolve the `devices.id` (indoor_cpe/outdoor_cpe) monitored for a client's
 * active contract's TR-069 CPE. Returns null if there is no active contract
 * or no monitored CPE.
 */
async function _resolveCpeDeviceId(clientId, orgId) {
  const [rows] = await db.query(
    `SELECT cd.device_id
       FROM cpe_devices cd
       JOIN contracts c ON c.id = cd.contract_id
       JOIN devices d ON d.id = cd.device_id
      WHERE c.client_id = ? AND c.organization_id = ? AND c.status = 'active'
        AND cd.deleted_at IS NULL AND cd.device_id IS NOT NULL
        AND d.type IN ('indoor_cpe', 'outdoor_cpe') AND d.deleted_at IS NULL
      ORDER BY cd.id DESC LIMIT 1`,
    [clientId, orgId],
  );
  return rows[0]?.device_id ?? null;
}

/**
 * Latest ONU state + optical metrics for a monitored device, or null.
 */
async function _getOnuStatus(deviceId, orgId) {
  const [rows] = await db.query(
    `SELECT od.onu_state, od.olt_port_id, om.rx_power_dbm, om.tx_power_dbm
       FROM onu_details od
       LEFT JOIN onu_optical_metrics om ON om.device_id = od.device_id
      WHERE od.device_id = ? AND od.organization_id = ?
      ORDER BY om.polled_at DESC LIMIT 1`,
    [deviceId, orgId],
  );
  return rows[0] || null;
}

/**
 * Latest wireless signal observation for a monitored CPE device, or null.
 */
async function _getWirelessSignal(deviceId, orgId) {
  const [rows] = await db.query(
    `SELECT signal_dbm, noise_floor_dbm, ccq_pct
       FROM wireless_client_sessions
      WHERE client_device_id = ? AND organization_id = ?
      ORDER BY last_seen_at DESC LIMIT 1`,
    [deviceId, orgId],
  );
  return rows[0] || null;
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

  // HIGH — item 2 of the third adversarial review: a RADIUS/PPPoE session
  // says nothing about ACCESS TYPE — fixed-wireless PtMP subscribers
  // authenticate via RADIUS too (that's what activated this bug: the line
  // was dead on `main`, since getSessionByClientId didn't exist and always
  // threw, keeping 'unknown'; once it started working, every wireless
  // customer with a session got misclassified as fiber and ran the fiber
  // diagnostic — onu/olt checks all 'unknown', "no critical issues
  // detected", and their real wireless signal was never checked at all).
  //
  // Infer from the actual DEVICE type instead, using the same discriminators
  // the rest of this file already relies on: devices.type='onu' (via
  // _resolveOnuDeviceId) means fiber; indoor_cpe/outdoor_cpe (via
  // _resolveCpeDeviceId) means wireless. If neither resolves, we genuinely
  // don't know the access type — 'unknown', never a guess. An explicit
  // caller-supplied accessType (validated by the route) always wins and
  // never reaches this inference at all.
  if (resolvedAccessType === 'unknown') {
    try {
      const onuDeviceId = await _resolveOnuDeviceId(clientId, orgId);
      if (onuDeviceId) {
        resolvedAccessType = 'fiber';
      } else {
        const cpeDeviceId = await _resolveCpeDeviceId(clientId, orgId);
        resolvedAccessType = cpeDeviceId ? 'wireless' : 'unknown';
      }
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
  //
  // HIGH — item 1 of the third adversarial review: onu_optical_metrics is
  // NEVER written by anything in this codebase (ftth_onu_optical_poll is
  // logged as "not yet implemented" in taskRunner.js — there is no dedicated
  // poller), so rx_power_dbm/tx_power_dbm are ALWAYS null on every real
  // deployment. `rx_power_dbm !== null && rx_power_dbm > -27` collapsed that
  // permanent NULL into "below threshold" — a fabricated optical fault for
  // 100% of fiber customers, reported as a 'known' check (inflating
  // confidence), triggering "a technician visit may be required", and
  // persisted to ai_diagnostic_runs. Missing telemetry is 'unknown', never
  // 'error' — it must not count as a known check either.
  try {
    const deviceId = await _resolveOnuDeviceId(clientId, orgId);
    const onu = deviceId ? await _getOnuStatus(deviceId, orgId) : null;
    if (!onu) {
      checks.push({ name: 'onu_signal', status: 'unknown', detail: 'ONU device not found' });
    } else if (onu.rx_power_dbm === null) {
      checks.push({
        name: 'onu_signal',
        status: 'unknown',
        detail: 'Optical telemetry unavailable (ONU optical polling not yet implemented)',
      });
    } else {
      const rxOk = onu.rx_power_dbm > -27;
      checks.push({
        name: 'onu_signal',
        status: rxOk ? 'ok' : 'error',
        detail: `RX: ${onu.rx_power_dbm} dBm, TX: ${onu.tx_power_dbm} dBm, State: ${onu.onu_state}`,
      });
    }
  } catch {
    checks.push({ name: 'onu_signal', status: 'unknown', detail: 'Service unavailable' });
  }

  // Check 3: OLT port utilization
  try {
    const deviceId = await _resolveOnuDeviceId(clientId, orgId);
    const onu = deviceId ? await _getOnuStatus(deviceId, orgId) : null;
    if (!onu || !onu.olt_port_id) {
      checks.push({ name: 'olt_port', status: 'unknown', detail: 'OLT port not found' });
    } else {
      const [portRows] = await db.query(
        'SELECT port_no, onu_count, max_onus FROM olt_ports WHERE id = ? AND organization_id = ?',
        [onu.olt_port_id, orgId],
      );
      if (portRows.length === 0) {
        checks.push({ name: 'olt_port', status: 'unknown', detail: 'OLT port not found' });
      } else {
        const port = portRows[0];
        const overloaded = port.max_onus > 0 && port.onu_count > port.max_onus * 0.85;
        checks.push({
          name: 'olt_port',
          status: overloaded ? 'warning' : 'ok',
          detail: `Port ${port.port_no}: ${port.onu_count}/${port.max_onus} ONUs`,
        });
      }
    }
  } catch {
    checks.push({ name: 'olt_port', status: 'unknown', detail: 'OLT data unavailable' });
  }

  // Check 4: Active alerts for device
  // alert_events has no `severity` column (it lives on the parent alert_rules
  // row) and status is ENUM('triggered','acknowledged','resolved') — there is
  // no 'active' value. "Active" = not yet resolved.
  //
  // MEDIUM — item 7 of the second adversarial review: `ae.device_id = ?`
  // with a NULL deviceId is not a SQL error (MySQL just matches nothing), so
  // when the client's device couldn't be resolved at all this used to
  // confidently report "0 high/critical alerts — ok" instead of admitting it
  // never actually checked anything. An unresolved device must report
  // 'unknown', never a clean bill of health.
  try {
    const deviceId = await _resolveOnuDeviceId(clientId, orgId);
    if (!deviceId) {
      checks.push({ name: 'active_alerts', status: 'unknown', detail: 'Device not resolved — cannot check alerts' });
    } else {
      const [alerts] = await db.query(
        `SELECT COUNT(*) AS cnt
           FROM alert_events ae
           JOIN alert_rules ar ON ar.id = ae.alert_rule_id
          WHERE ae.organization_id = ? AND ae.status != 'resolved' AND ar.severity IN ('critical','major')
            AND ae.device_id = ?`,
        [orgId, deviceId],
      );
      const alertCount = alerts[0]?.cnt ?? 0;
      checks.push({
        name: 'active_alerts',
        status: alertCount > 0 ? 'warning' : 'ok',
        detail: `${alertCount} high/critical alerts on ONU device`,
      });
    }
  } catch {
    checks.push({ name: 'active_alerts', status: 'unknown', detail: 'Alert service unavailable' });
  }

  // Check 5: Account status
  // NOTE: contracts has no data-cap-throttle column in the schema — data cap
  // tracking is not yet implemented, so this only reports contract status.
  try {
    const [rows] = await db.query(
      `SELECT c.status
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
        WHERE cl.id = ? AND c.status = 'active'
        ORDER BY c.id DESC LIMIT 1`,
      [clientId],
    );
    if (rows.length > 0) {
      checks.push({
        name: 'account_status',
        status: 'ok',
        detail: `Contract status: ${rows[0].status}`,
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
  //
  // wireless_client_sessions.signal_dbm IS actively written (unlike
  // onu_optical_metrics) but is nullable and can legitimately be NULL for a
  // real observation (see wirelessService.recordClientSessions: `s.signal_dbm
  // || null`) — same NULL-means-bad inversion as the ONU checks, just a
  // narrower window. A missing reading on an existing session is 'unknown',
  // not a fabricated 'warning'.
  try {
    const deviceId = await _resolveCpeDeviceId(clientId, orgId);
    const signal = deviceId ? await _getWirelessSignal(deviceId, orgId) : null;
    if (!signal) {
      checks.push({ name: 'cpe_signal', status: 'unknown', detail: 'CPE device not found' });
    } else if (signal.signal_dbm === null) {
      checks.push({
        name: 'cpe_signal',
        status: 'unknown',
        detail: 'Signal telemetry unavailable for this CPE observation',
      });
    } else {
      const signalOk = signal.signal_dbm > -75;
      checks.push({
        name: 'cpe_signal',
        status: signalOk ? 'ok' : 'warning',
        detail: `Signal: ${signal.signal_dbm} dBm, Noise: ${signal.noise_floor_dbm} dBm, CCQ: ${signal.ccq_pct}%`,
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
  // NOTE: there is no access-point inventory / assignment table in the schema
  // (an `access_points` table with a `cpe_devices.access_point_id` FK was
  // referenced here, but neither exists) — AP-load reporting is not yet
  // implemented. Not a query worth attempting: it can never resolve.
  checks.push({ name: 'ap_load', status: 'unknown', detail: 'AP load reporting not yet implemented' });

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
  // NOTE: contracts has no data-cap-throttle column in the schema — data cap
  // tracking is not yet implemented.
  checks.push({ name: 'quota_status', status: 'unknown', detail: 'Data cap tracking not yet implemented' });

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
    const deviceId = await _resolveOnuDeviceId(clientId, orgId);
    const onu = deviceId ? await _getOnuStatus(deviceId, orgId) : null;
    if (!onu) {
      checks.push({ name: 'onu_status', status: 'unknown', detail: 'ONU not found' });
    } else {
      const offline = onu.onu_state !== 'online';
      checks.push({
        name: 'onu_status',
        status: offline ? 'error' : 'ok',
        detail: `ONU status: ${onu.onu_state}, RX: ${onu.rx_power_dbm} dBm`,
      });
    }
  } catch {
    checks.push({ name: 'onu_status', status: 'unknown', detail: 'ONU data unavailable' });
  }

  // Check 3: Account suspension
  try {
    const [rows] = await db.query(
      `SELECT c.status, cl.status AS client_status
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
        WHERE cl.id = ? ORDER BY c.id DESC LIMIT 1`,
      [clientId],
    );
    if (rows.length > 0) {
      const suspended = rows[0].client_status === 'suspended' || rows[0].status === 'suspended';
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
  // NOTE: alert_events (real table; `alerts` does not exist) has no
  // categorical `alert_type` column to filter on — alert categorization by
  // infrastructure type is not yet implemented, so this cannot be narrowed to
  // "OLT hardware" specifically without guessing at metric-name conventions.
  checks.push({ name: 'olt_hardware', status: 'unknown', detail: 'OLT hardware alert categorization not yet implemented' });

  // Check 5: Fiber splice alert — same limitation as Check 4.
  checks.push({ name: 'fiber_splice', status: 'unknown', detail: 'Fiber alert categorization not yet implemented' });

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
      `SELECT cd.status, cd.device_id
         FROM cpe_devices cd
         JOIN contracts c ON c.id = cd.contract_id
        WHERE c.client_id = ? AND c.organization_id = ? AND c.status = 'active'
          AND cd.deleted_at IS NULL
        ORDER BY cd.id DESC LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length === 0) {
      checks.push({ name: 'cpe_status', status: 'unknown', detail: 'CPE not found' });
    } else {
      const cpe = rows[0];
      // cpe_devices.status is ENUM('new','provisioning','active','error',
      // 'offline') — there is no 'online' value; 'active' is the up state.
      const offline = cpe.status !== 'active';
      const signal = cpe.device_id ? await _getWirelessSignal(cpe.device_id, orgId) : null;
      checks.push({
        name: 'cpe_status',
        status: offline ? 'error' : 'ok',
        detail: `CPE status: ${cpe.status}, Signal: ${signal ? signal.signal_dbm : 'unknown'} dBm`,
      });
    }
  } catch {
    checks.push({ name: 'cpe_status', status: 'unknown', detail: 'CPE data unavailable' });
  }

  // Check 3: AP status
  // NOTE: there is no access-point inventory / assignment table in the schema
  // — see _diagSlowWireless's ap_load check for the same limitation.
  checks.push({ name: 'ap_status', status: 'unknown', detail: 'AP status reporting not yet implemented' });

  // Check 4: Account suspension
  try {
    const [rows] = await db.query(
      'SELECT status FROM clients WHERE id = ?',
      [clientId],
    );
    const suspended = rows[0]?.status === 'suspended';
    checks.push({
      name: 'account_suspension',
      status: suspended ? 'error' : 'ok',
      detail: suspended ? 'Account suspended' : 'Account active',
    });
  } catch {
    checks.push({ name: 'account_suspension', status: 'unknown', detail: 'Account data unavailable' });
  }

  // Check 5: Area alerts
  // Same alert_events shape note as the active_alerts check above.
  //
  // item 8 of the second adversarial review: this used to count ANY
  // critical alert anywhere in the whole org as "an outage in your area" —
  // a critical CPU alert on a router across town would tell this customer
  // there's a local outage. `devices.site_id` is the closest real
  // geographic grouping in the schema; scope to alerts on devices sharing
  // the client's own CPE's site. If the client's device (or its site)
  // can't be resolved, we genuinely don't know whether there's a local
  // outage — report 'unknown', not a fabricated "no outage detected".
  try {
    const deviceId = await _resolveCpeDeviceId(clientId, orgId);
    const [siteRows] = deviceId
      ? await db.query('SELECT site_id FROM devices WHERE id = ? AND organization_id = ?', [deviceId, orgId])
      : [[]];
    const siteId = siteRows[0]?.site_id ?? null;

    if (!siteId) {
      checks.push({ name: 'area_outage', status: 'unknown', detail: 'Site not resolved — cannot check for a local outage' });
    } else {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS cnt
           FROM alert_events ae
           JOIN alert_rules ar ON ar.id = ae.alert_rule_id
           JOIN devices ad ON ad.id = ae.device_id
          WHERE ae.organization_id = ? AND ae.status != 'resolved' AND ar.severity = 'critical'
            AND ad.site_id = ?`,
        [orgId, siteId],
      );
      const hasOutage = (rows[0]?.cnt ?? 0) > 0;
      checks.push({
        name: 'area_outage',
        status: hasOutage ? 'warning' : 'ok',
        detail: hasOutage ? 'Critical alerts active in your area — possible service outage' : 'No area-wide outage detected',
      });
    }
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
      `SELECT cd.model_name, cd.firmware_version
         FROM cpe_devices cd
         JOIN contracts c ON c.id = cd.contract_id
        WHERE c.client_id = ? AND c.organization_id = ? AND c.status = 'active'
          AND cd.deleted_at IS NULL
        ORDER BY cd.id DESC LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length > 0) {
      checks.push({
        name: 'cpe_model',
        status: 'ok',
        detail: `CPE model: ${rows[0].model_name}, Firmware: ${rows[0].firmware_version || 'unknown'}`,
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
      const deviceId = await _resolveCpeDeviceId(clientId, orgId);
      const signal = deviceId ? await _getWirelessSignal(deviceId, orgId) : null;
      if (signal) {
        const snr = (signal.signal_dbm || 0) - (signal.noise_floor_dbm || -100);
        checks.push({
          name: 'signal_stability',
          status: snr < 15 ? 'warning' : 'ok',
          detail: `Signal: ${signal.signal_dbm} dBm, SNR: ${snr} dB`,
        });
      } else {
        checks.push({ name: 'signal_stability', status: 'unknown', detail: 'CPE not found' });
      }
    } catch {
      checks.push({ name: 'signal_stability', status: 'unknown', detail: 'CPE data unavailable' });
    }
  } else {
    // Same onu_optical_metrics-never-written NULL-means-bad inversion as the
    // onu_signal check above — a NULL reading here must be 'unknown', not a
    // fabricated 'warning'.
    try {
      const deviceId = await _resolveOnuDeviceId(clientId, orgId);
      const onu = deviceId ? await _getOnuStatus(deviceId, orgId) : null;
      if (!onu) {
        checks.push({ name: 'onu_signal_stability', status: 'unknown', detail: 'ONU not found' });
      } else if (onu.rx_power_dbm === null) {
        checks.push({
          name: 'onu_signal_stability',
          status: 'unknown',
          detail: 'Optical telemetry unavailable (ONU optical polling not yet implemented)',
        });
      } else {
        const rxOk = onu.rx_power_dbm > -27;
        checks.push({
          name: 'onu_signal_stability',
          status: rxOk ? 'ok' : 'warning',
          detail: `ONU RX: ${onu.rx_power_dbm} dBm, Status: ${onu.onu_state}`,
        });
      }
    } catch {
      checks.push({ name: 'onu_signal_stability', status: 'unknown', detail: 'ONU data unavailable' });
    }
  }

  // Check 3: Power fluctuation / UPS alerts
  // NOTE: alert_events has no `alert_type` column — see the OLT-hardware /
  // fiber checks in _diagNoInternetFiber for the same limitation.
  checks.push({ name: 'power_alerts', status: 'unknown', detail: 'Power/UPS alert categorization not yet implemented' });

  // Check 4: Router/CPE reboots (firmware)
  try {
    const [rows] = await db.query(
      `SELECT cd.firmware_version, cd.last_inform_at
         FROM cpe_devices cd
         JOIN contracts c ON c.id = cd.contract_id
        WHERE c.client_id = ? AND c.organization_id = ? AND c.status = 'active'
          AND cd.deleted_at IS NULL
        ORDER BY cd.id DESC LIMIT 1`,
      [clientId, orgId],
    );
    if (rows.length > 0) {
      const lastInform = rows[0].last_inform_at;
      const stale = lastInform && (Date.now() - new Date(lastInform).getTime()) > 3600000;
      checks.push({
        name: 'cpe_reachability',
        status: stale ? 'warning' : 'ok',
        detail: `Last seen: ${lastInform || 'unknown'}, Firmware: ${rows[0].firmware_version || 'unknown'}`,
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
    const deviceId = await _resolveOnuDeviceId(clientId, orgId);
    const onu = deviceId ? await _getOnuStatus(deviceId, orgId) : null;
    if (!onu || !onu.olt_port_id) {
      checks.push({ name: 'pon_utilization', status: 'unknown', detail: 'PON data unavailable' });
    } else {
      const [portRows] = await db.query(
        'SELECT port_no, onu_count, max_onus FROM olt_ports WHERE id = ? AND organization_id = ?',
        [onu.olt_port_id, orgId],
      );
      if (portRows.length === 0) {
        checks.push({ name: 'pon_utilization', status: 'unknown', detail: 'PON data unavailable' });
      } else {
        const port = portRows[0];
        const util = port.onu_count / (port.max_onus || 1);
        checks.push({
          name: 'pon_utilization',
          status: util > 0.8 ? 'warning' : 'ok',
          detail: `PON port ${port.port_no}: ${port.onu_count}/${port.max_onus} ONUs (${Math.round(util * 100)}% utilization)`,
        });
      }
    }
  } catch {
    checks.push({ name: 'pon_utilization', status: 'unknown', detail: 'PON data unavailable' });
  }

  // Check 2: AP client density (wireless)
  // NOTE: there is no access-point inventory / assignment table in the schema
  // — see _diagSlowWireless's ap_load check for the same limitation.
  if (accessType === 'wireless') {
    checks.push({ name: 'ap_density', status: 'unknown', detail: 'AP density reporting not yet implemented' });
  }

  // Check 3: QoS policy applied
  // NOTE: there is no qos_policies table, and contracts has no qos_policy_id
  // column — per-contract QoS policy assignment is not yet implemented.
  checks.push({ name: 'qos_policy', status: 'unknown', detail: 'QoS policy assignment not yet implemented' });

  // Check 4: Data cap throttling
  // NOTE: plans.data_cap_gb exists, but there is no usage-tracking column
  // (contracts has no data_cap_status/data_used_gb) to compare it against —
  // data cap throttling is not yet implemented for this diagnostic.
  checks.push({ name: 'data_throttle', status: 'unknown', detail: 'Data cap tracking not yet implemented' });

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
// Escalation policy — which checks justify auto-creating a real support
// ticket (a technician truck roll — see supportConversationService.escalate).
//
// BINDING PRODUCT DECISION (ISP owner): this service area has frequent grid
// power outages and customers rarely run a UPS, so an offline/disconnected
// ONU or CPE, a dropped PPPoE/RADIUS session, or a suspended account are
// NORMAL day-to-day states here, not faults — auto-dispatching a technician
// for any of them would be wrong. Auto-escalation must fire ONLY on a
// genuine RF/optical QUALITY-degradation measurement the customer cannot fix
// by power-cycling anything:
//  - FIBER: bad optical RX power on the ONU (`onu_signal`, status 'error' —
//    rx_power_dbm <= -27, see _diagSlowFiber).
//  - WIRELESS: low CPE signal (`cpe_signal`). This check's threshold logic
//    (see _diagSlowWireless) emits status 'warning' — NOT 'error' — for
//    signal_dbm <= -75, so its escalation trigger must match 'warning'.
// Offline/status/session/account checks (onu_status, cpe_status,
// pppoe_session, radius_session, dhcp_session, account_suspension,
// disconnect_frequency) are explicitly EXCLUDED, on purpose, per the above —
// do not add any of them back to ESCALATE_WHEN without a new product
// decision.
//
// ESCALATE_WHEN is the single source of truth: { checkName: [statuses that
// trigger escalation] }. The -27 dBm / -75 dBm thresholds live in the check
// handlers above (_diagSlowFiber / _diagSlowWireless) and are tunable there —
// ESCALATE_WHEN only says which (name, status) combination coming out of
// those handlers counts as "quality degraded enough to dispatch a
// technician".
//
// NOT escalatable today, deliberately: wireless "capacity" (raised by the
// owner alongside signal quality) has no reliable per-client signal yet —
// `ap_load` is unimplemented (always 'unknown', see _diagSlowWireless) and
// `channel_interference` is computed org-wide via
// wirelessService.getInterferenceReport(orgId), not per client, so treating
// either as escalatable would auto-dispatch a technician for every wireless
// customer in the org simultaneously off a single interference event.
// Per-client wireless capacity escalation is pending ap_load telemetry — not
// escalatable today; flagged as a follow-up, not implemented here.
const ESCALATE_WHEN = {
  onu_signal: ['error'],
  cpe_signal: ['warning', 'error'],
};

function _escalatingChecks(checks) {
  return checks.filter(c => (ESCALATE_WHEN[c.name] || []).includes(c.status));
}

// ---------------------------------------------------------------------------
// Helper: build DiagnosticResult from checks array
// ---------------------------------------------------------------------------
function _buildResult(checks, defaultRecommendation) {
  const errorChecks = checks.filter(c => c.status === 'error');
  const knownChecks = checks.filter(c => c.status !== 'unknown').length;
  const confidence = checks.length > 0 ? knownChecks / checks.length : 0;
  // Blind run: every check came back 'unknown' (e.g. total service
  // unavailability). Without this branch a blind run and a genuinely clean
  // bill of health both fall through to the same reassuring
  // 'No critical issues detected' text — a false negative. Mirrors
  // _genericResult's honest zero-data phrasing above.
  const blind = checks.length > 0 && knownChecks === 0;

  // Escalate only on genuine RF/optical quality degradation — see
  // ESCALATE_WHEN above for the exact (check, status) set and the binding
  // product rationale (power outages are normal here; offline is not a
  // fault).
  const escalatingChecks = _escalatingChecks(checks);
  const escalate = escalatingChecks.length > 0;

  return {
    checks,
    cause: blind
      ? 'Unable to determine specific cause — manual review required'
      : errorChecks.length > 0
        ? `Issues detected: ${errorChecks.map(c => c.name).join(', ')}`
        : 'No critical issues detected',
    recommendation: blind ? 'Please contact technical support for assistance.' : defaultRecommendation,
    autoFixAvailable: 0,
    confidence: Math.round(confidence * 100) / 100,
    escalate,
    escalationReason: escalate ? 'Signal/optical quality degraded — technician recommended' : null,
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

// ---------------------------------------------------------------------------
// Customer-facing support reply generation (§21.2 / generateSupportResponse)
// ---------------------------------------------------------------------------
// generateSupportResponse() is the bridge between supportConversationService's
// technical-intent branch and this file's diagnostic handlers. It infers a
// symptom bucket from the customer's free-text message, runs a fresh
// diagnostic (never reusing supportContextService's summarized context — see
// agent-memory design decision D6), and synthesizes an honest, Spanish,
// customer-facing reply from the structured DiagnosticResult.
//
// It deliberately NEVER echoes result.cause / result.recommendation — those
// are internal/ops English phrasing intended for the ai_diagnostic_runs audit
// row (see _buildResult / _genericResult above), not the chat transcript.

// Symptom-inference regexes, matched in priority order (most specific/urgent
// first) against the already-sanitized customer message.
const _NO_INTERNET_RE = /\b(no (tengo|hay) internet|sin internet|no (conecta|funciona)|sin servicio|no (me )?llega( la)? se[ñn]al|se cay[oó] (el|la) (internet|servicio|conexi[oó]n)|totalmente ca[ií]do|not working|no service|\bdown\b|outage)\b/i;
const _WIFI_RE = /\b(wi-?fi|router|modem|contrase[ñn]a del? (router|wifi))\b/i;
const _DISCONNECTS_RE = /\b(se desconecta|se corta|intermitente|va y viene|cada rato|disconnect|se cae (cada|todo el tiempo))\b/i;
const _NIGHT_RE = /\b(noche|nocturn|at night|por las noches)\b/i;
const _SLOW_RE = /\b(lent[oa]|lentitud|slow|velocidad|va lento)\b/i;

/**
 * Infer a diagnostic symptom bucket from the customer's free-text message.
 * Falls through to 'general' (an honest "couldn't classify" bucket handled
 * by _genericResult) rather than guessing.
 *
 * @param {string} content
 * @returns {'no_internet'|'wifi'|'disconnects'|'slow_at_night'|'slow'|'general'}
 */
function _inferSymptom(content) {
  const t = content || '';
  if (_NO_INTERNET_RE.test(t)) return 'no_internet';
  if (_WIFI_RE.test(t)) return 'wifi';
  if (_DISCONNECTS_RE.test(t)) return 'disconnects';
  if (_SLOW_RE.test(t) && _NIGHT_RE.test(t)) return 'slow_at_night';
  if (_SLOW_RE.test(t)) return 'slow';
  return 'general'; // unrecognized -> runDiagnostic() falls through to _genericResult; honest, not a guess
}

// Friendly Spanish labels for every checks[].name value emitted anywhere in
// this file — used to describe *what* was checked without exposing internal
// check identifiers to the customer.
const _CHECK_LABELS = {
  pppoe_session: 'tu sesión de conexión (PPPoE)',
  onu_signal: 'la señal óptica de tu equipo ONU',
  onu_signal_stability: 'la estabilidad de la señal óptica',
  onu_status: 'el estado de tu equipo ONU',
  olt_port: 'el puerto del equipo del proveedor (OLT)',
  olt_hardware: 'el hardware del equipo del proveedor (OLT)',
  active_alerts: 'alertas activas en tu equipo',
  account_status: 'el estado de tu contrato',
  account_suspension: 'el estado de tu cuenta',
  cpe_signal: 'la señal de tu equipo (router/CPE)',
  cpe_status: 'el estado de tu equipo (router/CPE)',
  cpe_model: 'la información de tu equipo',
  cpe_reachability: 'la comunicación con tu equipo',
  radius_session: 'tu sesión de conexión',
  dhcp_session: 'la asignación de tu dirección de red',
  router_reachability: 'la comunicación con tu router',
  channel_interference: 'interferencia en el canal inalámbrico',
  area_outage: 'una posible falla en tu zona',
  disconnect_frequency: 'la frecuencia de desconexiones',
  signal_stability: 'la estabilidad de tu señal',
  pon_utilization: 'la carga del equipo del proveedor',
  recurring_wifi_issue: 'reportes previos relacionados con tu wifi',
  fiber_splice: 'una posible falla física en la fibra',
  power_alerts: 'una posible falla de energía en el equipo',
  ap_density: 'la densidad de antenas en tu zona',
  ap_load: 'la carga de la antena que te da servicio',
  ap_status: 'el estado de la antena que te da servicio',
  data_throttle: 'límites de datos en tu plan',
  qos_policy: 'la prioridad de tráfico configurada',
  quota_status: 'tu consumo de datos',
  generic_check: 'tu reporte',
};

function _labelChecks(checks) {
  const uniq = [...new Set(checks.map(c => _CHECK_LABELS[c.name] || c.name))];
  if (uniq.length === 0) return 'tu conexión';
  if (uniq.length === 1) return uniq[0];
  return `${uniq.slice(0, -1).join(', ')} y ${uniq[uniq.length - 1]}`;
}

// Self-serve tip per symptom bucket — offered alongside every non-blind reply.
const _SELF_SERVE_TIPS = {
  slow: 'Te recomendamos reiniciar tu router/ONT (desconéctalo 30 segundos y vuelve a conectarlo) y, si es posible, probar por cable para confirmar si la velocidad mejora.',
  no_internet: 'Verifica que los cables de tu router/ONT estén bien conectados y que las luces indicadoras estén encendidas; si no es así, reinicia el equipo desconectándolo 30 segundos.',
  wifi: 'Prueba reiniciar tu router y acercarte al equipo para confirmar si la señal wifi mejora; si el problema es solo en un área de tu casa, puede tratarse de la distancia al router.',
  disconnects: 'Revisa que el cable de tu router/ONT no esté flojo y evita usar extensiones o conectores adicionales en la línea.',
  slow_at_night: 'La lentitud en horas de mayor demanda (noche) puede deberse a la congestión de la red; de cualquier forma te recomendamos reiniciar tu router para descartar una causa local.',
  general: 'Te recomendamos reiniciar tu router/ONT y contarnos si el problema continúa.',
};

function _selfServeTip(symptom) { return _SELF_SERVE_TIPS[symptom] || _SELF_SERVE_TIPS.general; }

/**
 * Build the Spanish customer-facing reply from a DiagnosticResult. Never
 * reads result.cause / result.recommendation (see file-header note above) —
 * those remain internal/ops fields, persisted as-is to ai_diagnostic_runs by
 * _storeRun.
 *
 * Honesty rules enforced here (do not weaken without a product decision):
 *  - A "clean bill of health" ("no encontramos problemas") may ONLY be said
 *    when every check actually ran (full coverage). On fiber, the optical
 *    checks (onu_signal/olt_port) are routinely 'unknown' because polling
 *    isn't implemented yet — reporting "todo bien" from a partial run would
 *    be a false clean result for a majority of fiber customers.
 *  - A fully-blind run (every check 'unknown') must not claim a specific
 *    cause it doesn't know (e.g. "monitoring didn't respond") — it can be
 *    blind because the symptom was unclassifiable or the client's device
 *    isn't on file, not just a service outage.
 *  - No non-escalating path may promise that a human/technician has been
 *    tasked to follow up — escalate:true is the ONLY path that actually
 *    creates a ticket (see supportConversationService.escalate). Every other
 *    branch must offer an honest next step ("respóndenos" / "contáctanos")
 *    instead of a fabricated commitment.
 *
 * @param {string} symptom
 * @param {import('./diagnosticEngineService').DiagnosticResult} result
 * @returns {string}
 */
function _buildCustomerReply(symptom, result) {
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const errorChecks = checks.filter(c => c.status === 'error');
  const warningChecks = checks.filter(c => c.status === 'warning');
  const knownChecks = checks.filter(c => c.status !== 'unknown');
  const blind = checks.length > 0 && knownChecks.length === 0;
  // Partial coverage: some checks ran (knownChecks non-empty) but at least
  // one did not (e.g. optical telemetry unavailable) — distinct from both
  // "blind" (nothing ran) and "full coverage" (everything ran). Only
  // relevant to the no-error/no-warning tail below, since an error/warning
  // already makes clear the run wasn't a clean pass either way.
  const partialCoverage = !blind && knownChecks.length < checks.length;

  if (blind) {
    // Fully blind: don't assert a false specific cause (see honesty rules
    // above), and don't promise a human review that isn't actually tasked —
    // escalate is false on this path, so no ticket exists. Whether a blind
    // run should auto-open a review ticket is a ticket-volume product
    // decision left to the user; deliberately NOT auto-escalated here.
    const tip = _selfServeTip(symptom);
    return 'No pudimos completar el diagnóstico automático de tu conexión en este momento. Mientras tanto, ' + tip.charAt(0).toLowerCase() + tip.slice(1) + ' Si el problema continúa, respóndenos con más detalles o contáctanos y con gusto te ayudamos.';
  }

  if (result.escalate) {
    // escalate:true DOES create a real ticket (generateSupportResponse ->
    // supportConversationService.escalate) — this wording is truthful and
    // must stay as-is. Name exactly the check(s) that triggered escalation
    // (see ESCALATE_WHEN / _escalatingChecks above) — NOT errorChecks: a
    // 'warning'-driven escalation (e.g. cpe_signal) has no errorChecks, and
    // falling back to `checks` would wrongly dump every check (including
    // unrelated 'unknown' ones) into this sentence.
    return `Detectamos una posible falla física relacionada con ${_labelChecks(_escalatingChecks(checks))} que puede requerir la visita de un técnico. Te estamos conectando con nuestro equipo para coordinar la revisión.`;
  }

  if (errorChecks.length > 0) {
    // Not escalating (handled above) — no ticket is created, so don't
    // promise a scheduled technical review; offer an honest next step.
    return `Revisamos tu conexión y encontramos un problema con ${_labelChecks(errorChecks)}. ${_selfServeTip(symptom)} Si el problema continúa, respóndenos con más detalles o contáctanos y con gusto te ayudamos.`;
  }

  if (warningChecks.length > 0) {
    return `Revisamos tu conexión: no encontramos una falla crítica, pero notamos algo relacionado con ${_labelChecks(warningChecks)} que vale la pena atender. ${_selfServeTip(symptom)}`;
  }

  if (partialCoverage) {
    // No error/warning among what ran, but coverage was incomplete — do not
    // claim a clean bill of health for a diagnostic that never finished.
    // Same "deliberately not auto-escalated pending a product decision" note
    // as the blind branch above applies here too.
    return `Revisamos tu conexión y no vimos fallas en lo que pudimos verificar, pero no logramos comprobar todo el diagnóstico en este momento. ${_selfServeTip(symptom)} Si el problema continúa, respóndenos con más detalles y lo revisamos a fondo.`;
  }

  // Full coverage, nothing wrong — the only case allowed to say this.
  return `Revisamos tu conexión y no encontramos problemas activos en este momento. ${_selfServeTip(symptom)} Si el problema persiste, respóndenos y con gusto programamos una revisión más a fondo.`;
}

/**
 * Generate a customer-facing AI support reply for a technical-intent chat
 * message, running a fresh diagnostic (never the summarized
 * supportContextService context — see agent-memory D6) and synthesizing
 * honest Spanish copy from the structured result.
 *
 * @param {object} params
 * @param {number|string} params.orgId
 * @param {number|string} params.clientId
 * @param {number|string|null} [params.conversationId]
 * @param {string} params.content — sanitized customer message
 * @returns {Promise<{ reply: string, escalate: boolean, escalationReason: string|null, diagnosticResult: object|null }>}
 */
async function generateSupportResponse({ orgId, clientId, conversationId, content }) {
  const symptom = _inferSymptom(content);
  let result;
  try {
    result = await runDiagnostic({ orgId, clientId, conversationId: conversationId || null, symptom, accessType: null });
  } catch (err) {
    logger.warn({ err: err.message, orgId, clientId, conversationId }, 'diagnosticEngineService.generateSupportResponse: runDiagnostic failed');
    // Same honesty rules as _buildCustomerReply's blind branch (see its
    // header comment): escalate is false here too, so no ticket exists —
    // don't promise a technician has been tasked to review this.
    return {
      reply: 'No pudimos completar el diagnóstico automático de tu conexión en este momento. Si el problema continúa, respóndenos con más detalles o contáctanos y con gusto te ayudamos.',
      escalate: false,
      escalationReason: null,
      diagnosticResult: null,
    };
  }
  return {
    reply: _buildCustomerReply(symptom, result),
    escalate: Boolean(result.escalate),
    escalationReason: result.escalationReason || null,
    diagnosticResult: result,
  };
}

module.exports = { runDiagnostic, generateSupportResponse };
