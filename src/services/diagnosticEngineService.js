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
// `escalate` is decided per the diagnosed client's active contract's two
// escalation toggles (migration 387: contracts.escalation_enabled /
// escalate_on_disconnect) — see the "Escalation policy" comment above
// _buildResult below for the full rule.
//
// Migration 388 — configurable RF/optical thresholds. Three checks compare
// live telemetry against a threshold that used to be a single hardcoded
// constant; each now resolves via a three-tier, null-safe `??` chain
// (most-specific wins), matching migration 387's contract-flag-wins-else-
// safe-default shape:
//   fiber optical min (dBm):      contract.optical_min_dbm ?? FIBER_OPTICAL_MIN_DBM_DEFAULT
//   wireless signal min (dBm):    contract.wireless_signal_min_dbm
//                                   ?? sector.signal_min_dbm ?? WIRELESS_SIGNAL_MIN_DBM_DEFAULT
//   wireless link-capacity min (Mbps): contract.wireless_link_capacity_min_mbps
//                                   ?? sector.link_capacity_min_mbps ?? null
// The "sector" is the serving AP's ap_sector_configs row, resolved from the
// CPE's latest wireless_client_sessions row (see _getWirelessSignal /
// _getApSectorThresholds below) — soft-delete-guarded (`deleted_at IS NULL`),
// same lesson as the contract lookup (#404). Link-capacity has NO global
// default: an unconfigured client's cpe_link_capacity check honestly reports
// 'unknown' rather than fabricating ok/warning against a made-up number.
// =============================================================================
'use strict';
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'diagnosticEngineService' });

// ---------------------------------------------------------------------------
// Diagnostic threshold defaults (migration 388) — code constants, not a
// settings-table row: the only existing "org setting" mechanism (the
// key/value `settings` table) has no organization_id column at all, so it is
// genuinely global across every tenant on a shared deployment — using it here
// would let one org's threshold choice silently leak into every other org's
// diagnostics. There is deliberately NO global default for wireless
// link-capacity: unset means the new cpe_link_capacity check reports
// 'unknown', never a fabricated ok/warning.
// ---------------------------------------------------------------------------
const FIBER_OPTICAL_MIN_DBM_DEFAULT = -27;
const WIRELESS_SIGNAL_MIN_DBM_DEFAULT = -75;

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
 *
 * Also returns `ap_device_id` (the serving AP that observed this client —
 * wireless_client_sessions.device_id, per-row on every observation, migration
 * 279) and `tx_rate_mbps`/`rx_rate_mbps` (the negotiated RF link rate,
 * migration 388) from the SAME row, so callers needing per-sector thresholds
 * or link-capacity never issue a second query for data already in hand.
 */
async function _getWirelessSignal(deviceId, orgId) {
  const [rows] = await db.query(
    `SELECT device_id AS ap_device_id, signal_dbm, noise_floor_dbm, ccq_pct,
            tx_rate_mbps, rx_rate_mbps
       FROM wireless_client_sessions
      WHERE client_device_id = ? AND organization_id = ?
      ORDER BY last_seen_at DESC LIMIT 1`,
    [deviceId, orgId],
  );
  return rows[0] || null;
}

/**
 * Per-sector diagnostic thresholds (migration 388) for the AP/PTP device that
 * served a client's latest wireless observation, or null if no matching
 * (non-deleted) sector config row exists.
 *
 * Soft-delete-guarded (`deleted_at IS NULL`) — the same lesson as
 * _resolveEscalationContract below (#404): ap_sector_configs rows are
 * soft-deleted (DELETE only sets deleted_at, with a /restore endpoint), so
 * omitting this guard could let a deleted duplicate sector config silently
 * win over the real one. `device_id` has no DB-enforced uniqueness (a
 * non-unique index only), so `ORDER BY id DESC LIMIT 1` is the established
 * idiom this file already uses for the same soft ambiguity elsewhere
 * (_resolveOnuDeviceId, _resolveCpeDeviceId, _resolveEscalationContract).
 * Never throws — callers already wrap this in the same try/catch that covers
 * the rest of the wireless signal lookup.
 */
async function _getApSectorThresholds(apDeviceId, orgId) {
  const [rows] = await db.query(
    `SELECT signal_min_dbm, link_capacity_min_mbps
       FROM ap_sector_configs
      WHERE device_id = ? AND (organization_id = ? OR organization_id IS NULL)
        AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [apDeviceId, orgId],
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

  // Resolve this client's active contract's escalation toggles (migration
  // 387) once, up front, and thread it into whichever handler runs below —
  // every handler's final _buildResult(...) call needs it to decide
  // escalate. Never throws; null (safe default: enabled, quality-only) if no
  // active contract resolves or the lookup fails.
  const contract = await _resolveEscalationContract(clientId, orgId);

  let result;

  if (symptom === 'slow' && resolvedAccessType === 'fiber') {
    result = await _diagSlowFiber(clientId, orgId, contract);
  } else if (symptom === 'slow' && resolvedAccessType === 'wireless') {
    result = await _diagSlowWireless(clientId, orgId, contract);
  } else if (symptom === 'no_internet' && resolvedAccessType === 'fiber') {
    result = await _diagNoInternetFiber(clientId, orgId, contract);
  } else if (symptom === 'no_internet' && resolvedAccessType === 'wireless') {
    result = await _diagNoInternetWireless(clientId, orgId, contract);
  } else if (symptom === 'wifi') {
    result = await _diagWifi(clientId, orgId, contract);
  } else if (symptom === 'disconnects') {
    result = await _diagDisconnects(clientId, orgId, resolvedAccessType, contract);
  } else if (symptom === 'slow_at_night') {
    result = await _diagSlowAtNight(clientId, orgId, resolvedAccessType, contract);
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

async function _diagSlowFiber(clientId, orgId, contract) {
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
      // Migration 388: per-contract override, else the org-wide code
      // constant — see the file-header comment block for the full
      // three-tier resolution shape.
      const opticalMinDbm = contract?.optical_min_dbm ?? FIBER_OPTICAL_MIN_DBM_DEFAULT;
      const rxOk = onu.rx_power_dbm > opticalMinDbm;
      checks.push({
        name: 'onu_signal',
        status: rxOk ? 'ok' : 'error',
        detail: `RX: ${onu.rx_power_dbm} dBm (min ${opticalMinDbm} dBm), TX: ${onu.tx_power_dbm} dBm, State: ${onu.onu_state}`,
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
  //
  // A soft-deleted contract (deleted_at set, status left untouched — see
  // _resolveEscalationContract's header comment for the full explanation)
  // shouldn't represent the client's account state either: without
  // `deleted_at IS NULL`, a deleted duplicate contract with a higher id
  // could win this `ORDER BY ... LIMIT 1` over the genuinely-active one.
  try {
    const [rows] = await db.query(
      `SELECT c.status
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
        WHERE cl.id = ? AND c.status = 'active' AND c.deleted_at IS NULL
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

  return _buildResult(checks, 'Check fiber connections and ONT device. If signal is low, a technician visit may be required.', contract);
}

async function _diagSlowWireless(clientId, orgId, contract) {
  const checks = [];

  // Check 1: CPE signal level
  //
  // wireless_client_sessions.signal_dbm IS actively written (unlike
  // onu_optical_metrics) but is nullable and can legitimately be NULL for a
  // real observation (see wirelessService.recordClientSessions: `s.signal_dbm
  // || null`) — same NULL-means-bad inversion as the ONU checks, just a
  // narrower window. A missing reading on an existing session is 'unknown',
  // not a fabricated 'warning'.
  //
  // The same row also carries the serving AP's device_id and the negotiated
  // TX/RX link rate (migration 388) — resolved once here so the new
  // cpe_link_capacity check right below reuses this exact lookup instead of
  // re-querying wireless_client_sessions a second time.
  let signal = null;
  let signalLookupFailed = false;
  try {
    const deviceId = await _resolveCpeDeviceId(clientId, orgId);
    signal = deviceId ? await _getWirelessSignal(deviceId, orgId) : null;
  } catch {
    signalLookupFailed = true;
  }

  // Serving sector's per-sector thresholds (migration 388), resolved from the
  // AP id carried on the session row above. Used by both cpe_signal and
  // cpe_link_capacity below. Never throws — no sector (no telemetry, no
  // configured sector row, or lookup failure) just means both checks fall
  // through to their next resolution tier (contract override already
  // considered first, then the org-wide default / no default for capacity).
  let sector = null;
  if (signal?.ap_device_id) {
    try {
      sector = await _getApSectorThresholds(signal.ap_device_id, orgId);
    } catch {
      sector = null;
    }
  }

  if (signalLookupFailed) {
    checks.push({ name: 'cpe_signal', status: 'unknown', detail: 'CPE service unavailable' });
  } else if (!signal) {
    checks.push({ name: 'cpe_signal', status: 'unknown', detail: 'CPE device not found' });
  } else if (signal.signal_dbm === null) {
    checks.push({
      name: 'cpe_signal',
      status: 'unknown',
      detail: 'Signal telemetry unavailable for this CPE observation',
    });
  } else {
    // Migration 388: contract override wins, else the serving sector's
    // default, else the org-wide code constant — see the file-header comment
    // block for the full three-tier resolution shape.
    const wirelessMinDbm = contract?.wireless_signal_min_dbm ?? sector?.signal_min_dbm ?? WIRELESS_SIGNAL_MIN_DBM_DEFAULT;
    const signalOk = signal.signal_dbm > wirelessMinDbm;
    checks.push({
      name: 'cpe_signal',
      status: signalOk ? 'ok' : 'warning',
      detail: `Signal: ${signal.signal_dbm} dBm (min ${wirelessMinDbm} dBm), Noise: ${signal.noise_floor_dbm} dBm, CCQ: ${signal.ccq_pct}%`,
    });
  }

  // Check 1b: CPE link capacity (migration 388, NEW) — the negotiated RF
  // link rate in Mbps (e.g. Ubiquiti "link capacity"), read from the same
  // session row's tx_rate_mbps/rx_rate_mbps. This is NOT the client-count/
  // AP-load percentage the separate, still-unimplemented `ap_load` check
  // below is meant to cover — the two are unrelated metrics with the same
  // "capacity" name in casual conversation, not a shared implementation.
  //
  // Honesty rule (this is genuinely new functionality, unlike cpe_signal
  // above which had an existing hardcoded comparison to make configurable):
  // status is 'unknown', never a fabricated ok/warning, whenever no
  // link-capacity threshold is configured for this client/sector (min
  // resolves to null — there is deliberately no org-wide default) OR there is
  // no recent link-rate telemetry at all on the resolved session row.
  if (signalLookupFailed) {
    checks.push({ name: 'cpe_link_capacity', status: 'unknown', detail: 'CPE service unavailable' });
  } else if (!signal) {
    checks.push({ name: 'cpe_link_capacity', status: 'unknown', detail: 'CPE device not found' });
  } else {
    const capacityMinRaw = contract?.wireless_link_capacity_min_mbps ?? sector?.link_capacity_min_mbps ?? null;
    // tx_rate_mbps/rx_rate_mbps/*_min_mbps are DECIMAL columns — mysql2
    // returns DECIMAL as a string (precision-safe default), not a JS number;
    // comparing/interpolating without Number() risks lexicographic string
    // comparison ("9.00" > "10.00") instead of numeric. Same idiom as this
    // codebase's other DECIMAL reads (e.g. billingService.js price_override).
    const capacityMinMbps = capacityMinRaw === null || capacityMinRaw === undefined ? null : Number(capacityMinRaw);
    const tx = signal.tx_rate_mbps === null || signal.tx_rate_mbps === undefined ? null : Number(signal.tx_rate_mbps);
    const rx = signal.rx_rate_mbps === null || signal.rx_rate_mbps === undefined ? null : Number(signal.rx_rate_mbps);
    if (capacityMinMbps === null) {
      checks.push({ name: 'cpe_link_capacity', status: 'unknown', detail: 'Link-capacity threshold not configured for this sector' });
    } else if (tx === null && rx === null) {
      checks.push({ name: 'cpe_link_capacity', status: 'unknown', detail: 'No recent link-rate telemetry' });
    } else {
      const belowMin = (tx !== null && tx < capacityMinMbps) || (rx !== null && rx < capacityMinMbps);
      checks.push({
        name: 'cpe_link_capacity',
        status: belowMin ? 'warning' : 'ok',
        detail: `TX ${tx ?? 'unknown'} / RX ${rx ?? 'unknown'} Mbps (min ${capacityMinMbps})`,
      });
    }
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

  return _buildResult(checks, 'Check CPE antenna alignment and AP channel. Consider channel change or CPE repositioning if signal is weak.', contract);
}

async function _diagNoInternetFiber(clientId, orgId, contract) {
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

  return _buildResult(checks, 'Verify ONT device is powered on. Check for service outages in your area. If account is suspended, review billing status.', contract);
}

async function _diagNoInternetWireless(clientId, orgId, contract) {
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

  return _buildResult(checks, 'Verify CPE antenna is powered and aligned. Check if area outage is affecting service. If account is suspended, resolve billing issue.', contract);
}

async function _diagWifi(clientId, orgId, contract) {
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
    contract,
  );
}

async function _diagDisconnects(clientId, orgId, accessType, contract) {
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
        // Migration 388: same resolved threshold as the onu_signal check
        // above — both fiber checks must move in lockstep.
        const opticalMinDbm = contract?.optical_min_dbm ?? FIBER_OPTICAL_MIN_DBM_DEFAULT;
        const rxOk = onu.rx_power_dbm > opticalMinDbm;
        checks.push({
          name: 'onu_signal_stability',
          status: rxOk ? 'ok' : 'warning',
          detail: `ONU RX: ${onu.rx_power_dbm} dBm (min ${opticalMinDbm} dBm), Status: ${onu.onu_state}`,
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
    contract,
  );
}

async function _diagSlowAtNight(clientId, orgId, accessType, contract) {
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
    contract,
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
// Per-contract configurable since migration 387 (`contracts.escalation_enabled`
// / `contracts.escalate_on_disconnect`) — see [[diagnostic-engine-escalate-quality-only]]
// in agent memory for the base rule's history.
//
// BINDING PRODUCT DECISION (ISP owner): the ORG-WIDE DEFAULT is that this
// service area has frequent grid power outages and customers rarely run a
// UPS, so an offline/disconnected ONU or CPE, a dropped PPPoE/RADIUS
// session, or a suspended account are NORMAL day-to-day states, not faults —
// auto-dispatching a technician for any of them would be wrong by default.
// Two tiers of escalatable check, and two per-contract toggles that control
// them:
//
//  QUALITY_ESCALATE (always active while escalation_enabled=1) — a genuine
//  RF/optical QUALITY-degradation measurement the customer cannot fix by
//  power-cycling anything:
//   - FIBER: bad optical RX power on the ONU (`onu_signal`, status 'error' —
//     rx_power_dbm <= the resolved optical threshold, see _diagSlowFiber;
//     migration 388: contract.optical_min_dbm ?? -27).
//   - WIRELESS: low CPE signal (`cpe_signal`). This check's threshold logic
//     (see _diagSlowWireless) emits status 'warning' — NOT 'error' — for a
//     signal below the resolved threshold (migration 388:
//     contract.wireless_signal_min_dbm ?? sector.signal_min_dbm ?? -75), so
//     its escalation trigger must match 'warning'.
//   - WIRELESS (migration 388, NEW): low negotiated link-capacity
//     (`cpe_link_capacity`, status 'warning' — tx_rate_mbps/rx_rate_mbps
//     below the resolved Mbps minimum, see _diagSlowWireless). A degraded RF
//     link rate is a per-client quality problem (the customer's own link is
//     struggling and will saturate the sector faster than a healthy one),
//     the same category as low signal — NOT the sector-wide `ap_load`
//     client-count/AP-load check below, which stays non-escalatable. Only
//     fires when a threshold is actually configured (contract or sector);
//     an unconfigured/no-telemetry client reports 'unknown', which is not in
//     any status list here and therefore never escalates.
//
//  DISCONNECT_ESCALATE (active ONLY when escalate_on_disconnect=1 — for
//  clients who DO have a UPS, where an offline/dropped state genuinely is
//  abnormal, not a normal power-outage side effect): onu_status / cpe_status
//  offline, or a dropped pppoe_session / radius_session. `account_suspension`
//  is deliberately never included in either tier — a billing hold is not a
//  disconnect/quality fault, it routes to payment, not a truck roll.
//  `disconnect_frequency` (the noisy pattern-based _diagDisconnects heuristic)
//  is also deliberately excluded from both tiers.
//
//  escalation_enabled=0 is a master switch: this contract NEVER
//  auto-escalates, on ANY check, regardless of the two tiers above — for a
//  client who has explicitly opted out of automatic dispatch.
//
// No contract resolved (e.g. no active contract on file) -> the safe org-wide
// default applies: enabled, quality-only (same as `escalate_on_disconnect=0`).
//
// STILL NOT escalatable, deliberately, in EITHER tier: the client-count/
// AP-load-percentage `ap_load` check (a genuinely different metric from the
// new cpe_link_capacity above — see _diagSlowWireless's Check 3 comment) and
// `channel_interference`, which is computed org-wide via
// wirelessService.getInterferenceReport(orgId), not per client — treating
// either as escalatable would auto-dispatch a technician for every wireless
// customer on/near an affected sector simultaneously off a single shared
// event, not a genuine per-client fault.
const QUALITY_ESCALATE = {
  onu_signal: ['error'],
  cpe_signal: ['warning', 'error'],
  cpe_link_capacity: ['warning'],
};
const DISCONNECT_ESCALATE = {
  onu_status: ['error'],
  cpe_status: ['error'],
  pppoe_session: ['error'],
  radius_session: ['error'],
};

/**
 * Which checks trigger escalation for this run, given the client's active
 * contract's two escalation toggles (or `null`/no contract -> safe defaults:
 * enabled, quality-only).
 *
 * @param {Array<{name:string, status:string}>} checks
 * @param {{escalation_enabled?:number|boolean, escalate_on_disconnect?:number|boolean}|null} contract
 */
function _escalatingChecks(checks, contract) {
  // Explicit escalation_enabled=0 -> never, on any check. No contract, or no
  // explicit 0, falls through to the enabled default.
  if (contract && Number(contract.escalation_enabled) === 0) return [];
  const map = {
    ...QUALITY_ESCALATE,
    ...((contract && Number(contract.escalate_on_disconnect) === 1) ? DISCONNECT_ESCALATE : {}),
  };
  return checks.filter(c => (map[c.name] || []).includes(c.status));
}

/**
 * Resolve the client's active contract's two escalation toggles (migration
 * 387) AND its three diagnostic-threshold overrides (migration 388:
 * optical_min_dbm / wireless_signal_min_dbm / wireless_link_capacity_min_mbps
 * — see the file-header comment block for the three-tier resolution shape
 * each one feeds). One round trip, not two: `contract` is already threaded
 * through every _diag* handler for the escalation toggles, so the same
 * object carries the threshold overrides too, with no signature change.
 * Returns `null` (safe default: enabled, quality-only, all thresholds at
 * their org-wide/no default) when there is no active contract or the lookup
 * fails — never throws.
 */
async function _resolveEscalationContract(clientId, orgId) {
  try {
    // HIGH — adversarial-review finding: contracts are soft-deleted
    // (Contract.softDelete=true; DELETE only sets deleted_at=NOW(), status
    // is left untouched, and there's a /restore endpoint — this is a normal,
    // reversible flow). Without `deleted_at IS NULL`, `ORDER BY id DESC
    // LIMIT 1` can pick a soft-deleted duplicate contract over the
    // genuinely-active one whenever the deleted row has a higher id. Concrete
    // harm: staff creates a duplicate contract with escalate_on_disconnect=1
    // by mistake, then deletes it — it's soft-deleted but still
    // status='active' and a higher id than the real contract, so it now wins
    // this lookup and every diagnosis silently escalates that non-UPS client
    // on plain disconnects (the exact unwanted truck roll this rule exists
    // to prevent). The inverse — a soft-deleted escalation_enabled=0 row
    // suppressing real quality escalation — also holds. Matches the
    // deleted_at-aware pattern already used elsewhere for the same table
    // (see supportContextService.js / topologyMapService.js).
    const [rows] = await db.query(
      `SELECT escalation_enabled, escalate_on_disconnect,
              optical_min_dbm, wireless_signal_min_dbm, wireless_link_capacity_min_mbps
         FROM contracts
        WHERE client_id = ? AND organization_id = ? AND status = 'active'
          AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [clientId, orgId],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: build DiagnosticResult from checks array
// ---------------------------------------------------------------------------
/**
 * @param {Array<{name:string, status:string, detail:string}>} checks
 * @param {string} defaultRecommendation
 * @param {{escalation_enabled?:number|boolean, escalate_on_disconnect?:number|boolean}|null} [contract]
 *   The diagnosed client's active contract's escalation toggles (migration
 *   387), or null if none resolved — see _escalatingChecks for the default.
 */
function _buildResult(checks, defaultRecommendation, contract) {
  const errorChecks = checks.filter(c => c.status === 'error');
  const knownChecks = checks.filter(c => c.status !== 'unknown').length;
  const confidence = checks.length > 0 ? knownChecks / checks.length : 0;
  // Blind run: every check came back 'unknown' (e.g. total service
  // unavailability). Without this branch a blind run and a genuinely clean
  // bill of health both fall through to the same reassuring
  // 'No critical issues detected' text — a false negative. Mirrors
  // _genericResult's honest zero-data phrasing above.
  const blind = checks.length > 0 && knownChecks === 0;

  // Escalate per this contract's toggles — see QUALITY_ESCALATE /
  // DISCONNECT_ESCALATE / _escalatingChecks above for the exact (check,
  // status) sets, the two contract flags, and the binding product rationale.
  const escalatingChecks = _escalatingChecks(checks, contract);
  const escalate = escalatingChecks.length > 0;
  // Distinguish which tier actually fired for a more useful audit trail /
  // support-facing escalationReason — a disconnect-driven escalation (only
  // possible when this contract has escalate_on_disconnect=1) is not a
  // signal-quality fault and shouldn't be reported as one.
  const qualityEscalated = escalatingChecks.some(c => Object.prototype.hasOwnProperty.call(QUALITY_ESCALATE, c.name));

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
    escalationReason: escalate
      ? (qualityEscalated
        ? 'Signal/optical quality degraded — technician recommended'
        : 'Offline/disconnected — technician recommended (contract has escalate_on_disconnect enabled)')
      : null,
    // Internal field, not part of the documented DiagnosticResult shape at
    // the top of this file — carries the resolved contract forward so
    // _buildCustomerReply can re-derive the SAME escalatingChecks set (for
    // naming which check(s) triggered escalation in the customer reply)
    // without a second contract lookup. _storeRun does not persist it.
    escalationContract: contract || null,
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
  cpe_link_capacity: 'la capacidad del enlace inalámbrico',
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
    // (see QUALITY_ESCALATE / DISCONNECT_ESCALATE / _escalatingChecks above)
    // — NOT errorChecks: a 'warning'-driven escalation (e.g. cpe_signal) has
    // no errorChecks, and falling back to `checks` would wrongly dump every
    // check (including unrelated 'unknown' ones) into this sentence.
    // result.escalationContract is the SAME contract _buildResult already
    // resolved and used to decide escalate:true — re-deriving with it here
    // (rather than `checks` alone) keeps this naming in lockstep with
    // whichever tier (quality vs disconnect) actually fired, without a
    // second contract lookup.
    return `Detectamos una posible falla física relacionada con ${_labelChecks(_escalatingChecks(checks, result.escalationContract))} que puede requerir la visita de un técnico. Te estamos conectando con nuestro equipo para coordinar la revisión.`;
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
