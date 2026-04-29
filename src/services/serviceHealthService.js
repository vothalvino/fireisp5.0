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
    const [rows] = await db.query(
      `SELECT r.username, r.status,
              cl.ip_address, cl.session_id,
              cl.bytes_in, cl.bytes_out, cl.session_time
       FROM radius r
       LEFT JOIN connection_logs cl
              ON cl.radius_id = r.id
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
      sessionTime: row.session_time,
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
    const [rows] = await db.query(
      `SELECT cl.event_type, cl.ip_address, cl.terminate_cause, cl.created_at
       FROM connection_logs cl
       JOIN radius r ON r.id = cl.radius_id
       WHERE r.contract_id = ?
       ORDER BY cl.id DESC
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
  try {
    const placeholders = deviceIds.map(() => '?').join(', ');
    const [rows] = await db.query(
      `SELECT sm.device_id, spo.oid_name, sm.value_gauge, sm.value_counter, sm.value_string, sm.polled_at
       FROM snmp_metrics sm
       JOIN snmp_profile_oids spo ON spo.id = sm.profile_oid_id
       WHERE sm.device_id IN (${placeholders})
         AND sm.polled_at >= NOW() - INTERVAL 15 MINUTE
       ORDER BY sm.device_id, spo.oid_name, sm.polled_at DESC`,
      deviceIds,
    );
    return rows.map(r => ({
      deviceId:  r.device_id,
      oidName:   r.oid_name,
      value:     r.value_gauge ?? r.value_counter ?? r.value_string,
      polledAt:  r.polled_at,
    }));
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
              p.download_speed, p.upload_speed
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
      downloadLimit: row.download_speed,
      uploadLimit:   row.upload_speed,
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
