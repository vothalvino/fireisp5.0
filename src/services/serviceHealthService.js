// =============================================================================
// FireISP 5.0 — Service Health Service (P1 §3.2)
// =============================================================================
// Combines all live and recent telemetry for a contract into a single
// deterministic JSON snapshot.  No LLM calls are made here.
//
// Snapshot shape:
//   {
//     contractId,
//     radiusSession: { online, username, ip, sessionTime, bytesIn, bytesOut } | null,
//     lastConnectionLog: { event_type, ip_address, terminate_cause, created_at } | null,
//     snmpMetrics: [{ deviceId, oidName, value, polledAt }],
//     routerOsQueue: { downloadLimit, uploadLimit, burst, enabled } | null,
//     lastSpeedTest: { downloadMbps, uploadMbps, latencyMs, testedAt } | null,
//   }
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'serviceHealthService' });

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Fetch the live RADIUS session for a contract, if one exists.
 * @param {number} contractId
 * @returns {Promise<object|null>}
 */
async function getRadiusSession(contractId) {
  try {
    // connection_logs has no `radius_id` column — it already carries
    // `contract_id` directly (the same key `radius.contract_id` uses), so no
    // join is needed at all. Column is `session_duration`, not `session_time`.
    const [rows] = await db.query(
      `SELECT r.username, r.status,
              cl.ip_address, cl.session_id,
              cl.bytes_in, cl.bytes_out, cl.session_duration
       FROM radius r
       LEFT JOIN connection_logs cl
              ON cl.contract_id = r.contract_id
             AND cl.event_type = 'start'
       WHERE r.contract_id = ? AND r.status = 'active'
       ORDER BY cl.id DESC
       LIMIT 1`,
      [contractId],
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      online:      row.status === 'active',
      username:    row.username,
      ip:          row.ip_address,
      sessionTime: row.session_duration,
      bytesIn:     row.bytes_in,
      bytesOut:    row.bytes_out,
    };
  } catch (err) {
    logger.warn({ contractId, err: err.message }, 'serviceHealthService: RADIUS session query failed');
    return null;
  }
}

/**
 * Fetch the most recent connection log event for a contract.
 * @param {number} contractId
 * @returns {Promise<object|null>}
 */
async function getLastConnectionLog(contractId) {
  try {
    // connection_logs.contract_id is direct — no join to radius needed (see
    // getRadiusSession above for the same fix).
    const [rows] = await db.query(
      `SELECT event_type, ip_address, terminate_cause, created_at
       FROM connection_logs
       WHERE contract_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [contractId],
    );
    return rows[0] || null;
  } catch (err) {
    logger.warn({ contractId, err: err.message }, 'serviceHealthService: connection log query failed');
    return null;
  }
}

/**
 * Fetch the most recent SNMP metric for each device in the topology path.
 * @param {number[]} deviceIds
 * @returns {Promise<Array>}
 */
async function getSnmpMetrics(deviceIds) {
  if (!deviceIds.length) return [];
  // Only pass numeric IDs to the query to prevent any injection risk if the
  // array originates from JSON deserialization rather than a direct DB lookup.
  const safeIds = deviceIds.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!safeIds.length) return [];
  try {
    // snmp_metrics is a WIDE table — one column per metric (cpu_usage,
    // signal_dbm, …) — not a narrow (device, oid, value) table, so it has no
    // profile_oid_id/value_gauge/value_counter/value_string columns. The
    // per-OID -> per-column mapping lives on snmp_profile_oids.metric_column
    // ("Target column in snmp_metrics", per its own schema comment), scoped
    // through devices.snmp_profile_id -> snmp_profiles. Resolve that mapping,
    // then pluck each configured OID's value out of the device's latest wide
    // row by column name — read as a plain JS property (never interpolated
    // into SQL), and guarded so a stale/garbage metric_column just yields no
    // value instead of throwing.
    const placeholders = safeIds.map(() => '?').join(', ');
    const [deviceRows] = await db.query(
      `SELECT id AS device_id, snmp_profile_id FROM devices
       WHERE id IN (${placeholders}) AND snmp_profile_id IS NOT NULL`,
      safeIds,
    );
    if (!deviceRows.length) return [];

    const profileIds = [...new Set(deviceRows.map((d) => d.snmp_profile_id))];
    const profilePlaceholders = profileIds.map(() => '?').join(', ');
    const [oidRows] = await db.query(
      `SELECT profile_id, label AS oid_name, metric_column FROM snmp_profile_oids
       WHERE profile_id IN (${profilePlaceholders}) AND status = 'active' AND deleted_at IS NULL`,
      profileIds,
    );
    if (!oidRows.length) return [];
    const oidsByProfile = new Map();
    for (const oid of oidRows) {
      if (!oidsByProfile.has(oid.profile_id)) oidsByProfile.set(oid.profile_id, []);
      oidsByProfile.get(oid.profile_id).push(oid);
    }

    const metricPlaceholders = safeIds.map(() => '?').join(', ');
    const [metricRows] = await db.query(
      `SELECT * FROM snmp_metrics
       WHERE device_id IN (${metricPlaceholders})
         AND polled_at >= NOW() - INTERVAL 15 MINUTE
         -- 15-minute window: SNMP poller default interval is ≤5 min; 15 min
         -- gives 3 poll cycles of headroom before data is considered stale.
       ORDER BY device_id, polled_at DESC`,
      safeIds,
    );
    const latestByDevice = new Map();
    for (const row of metricRows) {
      if (!latestByDevice.has(row.device_id)) latestByDevice.set(row.device_id, row);
    }

    const results = [];
    for (const device of deviceRows) {
      const latest = latestByDevice.get(device.device_id);
      if (!latest) continue;
      for (const oid of oidsByProfile.get(device.snmp_profile_id) || []) {
        if (!Object.prototype.hasOwnProperty.call(latest, oid.metric_column)) continue;
        const value = latest[oid.metric_column];
        if (value === null || value === undefined) continue;
        results.push({
          deviceId: device.device_id,
          oidName: oid.oid_name,
          value,
          polledAt: latest.polled_at,
        });
      }
    }
    return results;
  } catch (err) {
    logger.warn({ deviceIds, err: err.message }, 'serviceHealthService: SNMP metrics query failed');
    return [];
  }
}

/**
 * Fetch MikroTik queue state for the contract via RouterOS service.
 * Returns null when the device is unreachable or RouterOS is not applicable.
 * @param {number} contractId
 * @returns {Promise<object|null>}
 */
async function getRouterOsQueue(contractId) {
  try {
    const [rows] = await db.query(
      `SELECT d.ip_address, d.firerelay_node_id, d.type,
              p.download_speed_mbps, p.upload_speed_mbps
       FROM contracts c
       JOIN plans p ON p.id = c.plan_id
       JOIN devices d ON d.contract_id = c.id AND d.deleted_at IS NULL
              AND d.type IN ('router','other')
       WHERE c.id = ? AND c.deleted_at IS NULL
       LIMIT 1`,
      [contractId],
    );
    if (!rows.length) return null;

    const row = rows[0];
    // Return the plan-configured limits as the queue baseline.
    // Real-time queue inspection via routerosService is deferred to when
    // the FireRelay tunnel is available (requires firerelay_node_id).
    return {
      downloadLimit: row.download_speed_mbps,
      uploadLimit:   row.upload_speed_mbps,
      enabled:       true,
      source:        'plan_config',
    };
  } catch (err) {
    logger.warn({ contractId, err: err.message }, 'serviceHealthService: RouterOS queue query failed');
    return null;
  }
}

/**
 * Fetch the most recent speed test result for a contract.
 * @param {number} contractId
 * @returns {Promise<object|null>}
 */
async function getLastSpeedTest(contractId) {
  try {
    const [rows] = await db.query(
      `SELECT download_mbps, upload_mbps, latency_ms, jitter_ms,
              packet_loss_pct, tested_at
       FROM speed_tests
       WHERE contract_id = ? AND deleted_at IS NULL
       ORDER BY tested_at DESC
       LIMIT 1`,
      [contractId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      downloadMbps:    r.download_mbps,
      uploadMbps:      r.upload_mbps,
      latencyMs:       r.latency_ms,
      jitterMs:        r.jitter_ms,
      packetLossPct:   r.packet_loss_pct,
      testedAt:        r.tested_at,
    };
  } catch (err) {
    logger.warn({ contractId, err: err.message }, 'serviceHealthService: speed test query failed');
    return null;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build a comprehensive service-health snapshot for a contract.
 *
 * @param {number}   contractId
 * @param {number[]} [pathDeviceIds=[]]  Device IDs along the topology path
 *   (from topologyContextService.summarize); used for SNMP metric lookup.
 * @returns {Promise<object>}
 */
async function getSnapshot(contractId, pathDeviceIds = []) {
  logger.debug({ contractId }, 'Building service health snapshot');

  const [
    radiusSession,
    lastConnectionLog,
    snmpMetrics,
    routerOsQueue,
    lastSpeedTest,
  ] = await Promise.all([
    getRadiusSession(contractId),
    getLastConnectionLog(contractId),
    getSnmpMetrics(pathDeviceIds),
    getRouterOsQueue(contractId),
    getLastSpeedTest(contractId),
  ]);

  return {
    contractId,
    radiusSession,
    lastConnectionLog,
    snmpMetrics,
    routerOsQueue,
    lastSpeedTest,
  };
}

module.exports = { getSnapshot };
