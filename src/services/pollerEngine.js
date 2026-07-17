// =============================================================================
// FireISP 5.0 — Poller Engine Service (§6.4)
// =============================================================================
// Provides per-device polling interval management, adaptive polling for
// active outages, and performance snapshot recording.
//
// Functions:
//   getPollingConfig(deviceId)       — effective config for a device
//   pollWithConfig()                 — poll respecting per-device intervals
//   adaptivePollCheck()              — switch affected devices to adaptive intervals
//   recordPerformanceSnapshot()      — insert one row per active poller node
//   getPerformanceDashboard(nodeId, hours) — query snapshots for a node
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'pollerEngine' });
const { pollDevice } = require('./snmpPoller');
const deviceStatusService = require('./deviceStatusService');

// In-memory map: deviceId => { adaptive: true, minIntervalSec: N }
// Set by adaptivePollCheck(), cleared when outage resolves.
const adaptiveOverrides = new Map();

// ---------------------------------------------------------------------------
// getPollingConfig
// Returns effective polling config for a device using precedence:
//   1. Device-specific override (device_polling_configs.device_id = deviceId)
//   2. Device-type match (device_polling_configs.device_type = device.type, device_id IS NULL)
//   3. snmp_profile.poll_interval_sec (if device has snmp_profile_id)
//   4. Default: 300 seconds
// ---------------------------------------------------------------------------
async function getPollingConfig(deviceId) {
  // Fetch device-specific override first
  const [specificRows] = await db.query(
    `SELECT dpc.*, pn.max_concurrent_polls, pn.status AS node_status
     FROM device_polling_configs dpc
     LEFT JOIN poller_nodes pn ON pn.id = dpc.poller_node_id
     WHERE dpc.device_id = ?
       AND dpc.is_enabled = 1
       AND dpc.deleted_at IS NULL
     LIMIT 1`,
    [deviceId],
  );

  if (specificRows.length > 0) {
    const cfg = specificRows[0];
    // Apply adaptive override if active
    const adaptive = adaptiveOverrides.get(deviceId);
    if (adaptive && cfg.adaptive_polling_enabled) {
      cfg.poll_interval_sec = cfg.adaptive_min_interval_sec;
    }
    return cfg;
  }

  // Fetch device type for type-based lookup
  const [deviceRows] = await db.query(
    'SELECT type, snmp_profile_id FROM devices WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [deviceId],
  );

  if (deviceRows.length === 0) {
    return { poll_interval_sec: 300, bulk_get_enabled: 1, timeout_ms: 5000, retries: 1 };
  }

  const device = deviceRows[0];

  // Device-type match
  if (device.type) {
    const [typeRows] = await db.query(
      `SELECT * FROM device_polling_configs
       WHERE device_type = ?
         AND device_id IS NULL
         AND is_enabled = 1
         AND deleted_at IS NULL
       LIMIT 1`,
      [device.type],
    );

    if (typeRows.length > 0) {
      return typeRows[0];
    }
  }

  // Fall back to snmp_profile poll_interval_sec
  if (device.snmp_profile_id) {
    const [profileRows] = await db.query(
      'SELECT poll_interval_sec FROM snmp_profiles WHERE id = ? LIMIT 1',
      [device.snmp_profile_id],
    );
    if (profileRows.length > 0) {
      return {
        poll_interval_sec: profileRows[0].poll_interval_sec || 300,
        bulk_get_enabled: 1,
        timeout_ms: 5000,
        retries: 1,
      };
    }
  }

  // Default
  return { poll_interval_sec: 300, bulk_get_enabled: 1, timeout_ms: 5000, retries: 1 };
}

// ---------------------------------------------------------------------------
// pollWithConfig
// Like snmpPoller.poll() but respects per-device polling intervals.
// Skips devices whose next poll is not yet due (based on devices.last_polled_at).
// ---------------------------------------------------------------------------
const POLL_CONCURRENCY = parseInt(process.env.SNMP_POLL_CONCURRENCY || '10', 10);

// The scheduler ticks this every minute (migration 402) and its per-task lock
// does not cover a prior cycle still mid-flight in this process — a slow SNMP
// cycle must not stack a second sweep on top of itself.
let pollCycleInFlight = false;

async function pollWithConfig() {
  if (pollCycleInFlight) {
    return { polled: 0, skipped: 0, errors: 0, total: 0, overlap_skipped: true };
  }
  pollCycleInFlight = true;
  try {
    const [devices] = await db.query(`
      SELECT d.id, d.ip_address, d.snmp_community, d.snmp_version, d.snmp_port,
             d.snmp_profile_id, d.last_polled_at,
             d.snmp_v3_security_name, d.snmp_v3_auth_protocol,
             d.snmp_v3_auth_key_encrypted, d.snmp_v3_priv_protocol,
             d.snmp_v3_priv_key_encrypted, d.snmp_v3_context_name
      FROM devices d
      WHERE d.snmp_enabled = 1
        AND d.ip_address IS NOT NULL
        AND d.snmp_profile_id IS NOT NULL
        AND d.deleted_at IS NULL
    `);

    // Due-ness pass. getPollingConfig is a per-device lookup (up to 3 indexed
    // queries each); fine at current fleet sizes — batch-load configs here if
    // a deployment ever pushes this into the thousands of devices per tick.
    let skipped = 0;
    const due = [];
    const now = Date.now();
    for (const device of devices) {
      const cfg = await getPollingConfig(device.id);
      const intervalMs = (cfg.poll_interval_sec || 300) * 1000;
      const lastPolled = device.last_polled_at ? new Date(device.last_polled_at).getTime() : 0;
      if (now < lastPolled + intervalMs) {
        skipped++;
        continue;
      }
      due.push(device);
    }

    // Poll due devices in batches, mirroring snmpPoller.poll().
    let polled = 0;
    let errors = 0;
    for (let i = 0; i < due.length; i += POLL_CONCURRENCY) {
      const batch = due.slice(i, i + POLL_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(device => pollDevice(device)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const device = batch[j];
        if (result.status === 'fulfilled') {
          polled++;
          await deviceStatusService.recordPollResult(device.id, true)
            .catch(err2 => logger.warn({ err: err2, deviceId: device.id }, 'recordPollResult (success) failed'));
        } else {
          errors++;
          logger.error({ err: result.reason, deviceId: device.id }, 'pollWithConfig: device poll failed');
          await deviceStatusService.recordPollResult(device.id, false, String(result.reason?.message || result.reason))
            .catch(err2 => logger.warn({ err: err2, deviceId: device.id }, 'recordPollResult (failure) failed'));
        }
      }
    }

    return { polled, skipped, errors, total: devices.length };
  } finally {
    pollCycleInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// adaptivePollCheck
// Checks for active outages. For each affected device that has a polling
// config with adaptive_polling_enabled=1, sets an in-memory adaptive override.
// Clears overrides for devices whose outages have resolved.
// ---------------------------------------------------------------------------
async function adaptivePollCheck() {
  // Find devices currently in active outages
  const [activeOutageRows] = await db.query(
    `SELECT DISTINCT device_id FROM outages
     WHERE status = 'active'
       AND device_id IS NOT NULL`,
  );

  const activeDeviceIds = new Set(activeOutageRows.map(r => r.device_id));

  // Set adaptive overrides for affected devices that have adaptive polling enabled
  if (activeDeviceIds.size > 0) {
    const ids = [...activeDeviceIds];
    const placeholders = ids.map(() => '?').join(', ');
    const [cfgRows] = await db.query(
      `SELECT device_id, adaptive_min_interval_sec
       FROM device_polling_configs
       WHERE device_id IN (${placeholders})
         AND adaptive_polling_enabled = 1
         AND is_enabled = 1
         AND deleted_at IS NULL`,
      ids,
    );

    for (const cfg of cfgRows) {
      adaptiveOverrides.set(cfg.device_id, {
        adaptive: true,
        minIntervalSec: cfg.adaptive_min_interval_sec,
      });
    }
  }

  // Clear overrides for devices no longer in active outages
  for (const [deviceId] of adaptiveOverrides) {
    if (!activeDeviceIds.has(deviceId)) {
      adaptiveOverrides.delete(deviceId);
    }
  }

  return {
    activeOutageDevices: activeDeviceIds.size,
    adaptiveOverridesActive: adaptiveOverrides.size,
  };
}

// ---------------------------------------------------------------------------
// recordPerformanceSnapshot
// Reads all active poller_nodes and inserts one snapshot row per node.
// Also counts devices polled/failed in the last 5 minutes from devices table.
// ---------------------------------------------------------------------------
async function recordPerformanceSnapshot() {
  const [nodes] = await db.query(
    `SELECT id, current_queue_depth, avg_poll_duration_ms, total_polls_today, failed_polls_today
     FROM poller_nodes
     WHERE status = 'active'`,
  );

  if (nodes.length === 0) return { snapshots: 0 };

  // Count devices polled in last 5 minutes (approximation: last_polled_at recent)
  const [pollCounts] = await db.query(
    `SELECT
       COUNT(*) AS devices_polled,
       SUM(CASE WHEN last_poll_error IS NOT NULL THEN 1 ELSE 0 END) AS devices_failed
     FROM devices
     WHERE last_polled_at >= NOW() - INTERVAL 5 MINUTE
       AND deleted_at IS NULL`,
  );

  const devicesPolled = pollCounts[0]?.devices_polled || 0;
  const devicesFailed = pollCounts[0]?.devices_failed || 0;
  // devices_polled is COUNT(*) over recently-polled devices, so failed rows
  // are already inside it — it IS the total; adding failures again would
  // deflate the rate.
  const timeoutRatePct = devicesPolled > 0
    ? parseFloat(((devicesFailed / devicesPolled) * 100).toFixed(2))
    : null;

  let snapshots = 0;
  for (const node of nodes) {
    await db.query(
      `INSERT INTO poller_performance_snapshots
         (poller_node_id, devices_polled, devices_failed,
          avg_poll_duration_ms, queue_depth, timeout_rate_pct)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        node.id,
        devicesPolled,
        devicesFailed,
        node.avg_poll_duration_ms ?? null,
        node.current_queue_depth,
        timeoutRatePct,
      ],
    );
    snapshots++;
  }

  return { snapshots };
}

// ---------------------------------------------------------------------------
// getPerformanceDashboard
// Returns poller_performance_snapshots for a node over N hours.
// If nodeId is null, returns snapshots across all nodes.
// ---------------------------------------------------------------------------
async function getPerformanceDashboard(nodeId, hours) {
  const lookback = (parseInt(hours, 10) > 0 && parseInt(hours, 10) <= 8760)
    ? parseInt(hours, 10)
    : 24;

  const conditions = ['pps.snapshot_at >= NOW() - INTERVAL ? HOUR'];
  const params = [lookback];

  if (nodeId) {
    conditions.push('pps.poller_node_id = ?');
    params.push(nodeId);
  }

  const [rows] = await db.query(
    `SELECT pps.id, pps.poller_node_id, pn.name AS node_name,
            pps.snapshot_at, pps.devices_polled, pps.devices_failed,
            pps.avg_poll_duration_ms, pps.max_poll_duration_ms,
            pps.queue_depth, pps.timeout_rate_pct
     FROM poller_performance_snapshots pps
     LEFT JOIN poller_nodes pn ON pn.id = pps.poller_node_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY pps.snapshot_at DESC
     LIMIT 1000`,
    params,
  );

  return rows;
}

module.exports = {
  getPollingConfig,
  pollWithConfig,
  adaptivePollCheck,
  recordPerformanceSnapshot,
  getPerformanceDashboard,
};
