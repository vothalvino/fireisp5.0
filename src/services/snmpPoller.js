// =============================================================================
// FireISP 5.0 — SNMP Poller Service
// =============================================================================
// Polls SNMP-enabled devices using their profile OIDs and stores metrics in
// the snmp_metrics wide table.  Each profile OID's metric_column maps directly
// to a column in snmp_metrics (if_in_octets, cpu_usage, signal_strength, …).
// Called by the scheduler/taskRunner on a recurring interval.
// =============================================================================

const snmp = require('net-snmp');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'snmpPoller' });

// Columns in snmp_metrics that a profile OID may target.
const VALID_METRIC_COLUMNS = new Set([
  'if_in_octets',
  'if_out_octets',
  'if_in_errors',
  'if_out_errors',
  'cpu_usage',
  'memory_usage',
  'signal_strength',
  'latency_ms',
]);

// Configurable concurrency for parallel polling (default: 10 devices at a time)
const POLL_CONCURRENCY = parseInt(process.env.SNMP_POLL_CONCURRENCY || '10', 10);

/**
 * Poll all SNMP-enabled devices.
 * Returns { polled, errors, total }.
 */
async function poll() {
  const [devices] = await db.query(`
    SELECT d.id, d.ip_address, d.snmp_community, d.snmp_version, d.snmp_port,
           d.snmp_profile_id
    FROM devices d
    WHERE d.snmp_enabled = 1
      AND d.ip_address IS NOT NULL
      AND d.snmp_profile_id IS NOT NULL
      AND d.status = 'online'
  `);

  let polled = 0;
  let errors = 0;

  // Poll devices in batches for parallel execution
  for (let i = 0; i < devices.length; i += POLL_CONCURRENCY) {
    const batch = devices.slice(i, i + POLL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(device => pollDevice(device)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        polled++;
      } else {
        errors++;
        logger.error({ err: result.reason }, 'SNMP poll failed');
      }
    }
  }

  return { polled, errors, total: devices.length };
}

/**
 * Poll a single device for all OIDs defined in its SNMP profile and write one
 * row per device (scalar metrics) plus one row per interface (per-interface
 * metrics) into snmp_metrics.
 */
async function pollDevice(device) {
  const [oids] = await db.query(
    `SELECT id, oid, metric_column, label, oid_type, is_per_interface
     FROM snmp_profile_oids
     WHERE profile_id = ? AND status = 'active'
     ORDER BY sort_order`,
    [device.snmp_profile_id],
  );

  if (oids.length === 0) return;

  const version = device.snmp_version === 'v1' ? snmp.Version1 : snmp.Version2c;
  const session = snmp.createSession(device.ip_address, device.snmp_community || 'public', {
    port: device.snmp_port || 161,
    version,
    timeout: 5000,
    retries: 1,
  });

  try {
    const scalarOids = oids.filter(o => !o.is_per_interface);
    const ifOids = oids.filter(o => o.is_per_interface);

    // --- Scalar (device-level) metrics ------------------------------------
    const scalarRow = {};
    if (scalarOids.length > 0) {
      const oidStrings = scalarOids.map(o => o.oid);
      const varbinds = await snmpGet(session, oidStrings);

      for (let i = 0; i < scalarOids.length; i++) {
        const oid = scalarOids[i];
        const varbind = varbinds[i];
        if (!varbind || snmp.isVarbindError(varbind)) continue;
        if (!VALID_METRIC_COLUMNS.has(oid.metric_column)) continue;

        scalarRow[oid.metric_column] = extractNumericValue(varbind);
      }
    }

    // Insert a device-level row when we have at least one scalar metric.
    if (Object.keys(scalarRow).length > 0) {
      await insertMetricRow(device.id, null, scalarRow);
    }

    // --- Per-interface metrics ---------------------------------------------
    if (ifOids.length > 0) {
      await pollInterfaces(session, device, ifOids);
    }
  } finally {
    session.close();
  }
}

/**
 * Walk the interface table for per-interface OIDs and insert one row per
 * interface into snmp_metrics.
 */
async function pollInterfaces(session, device, ifOids) {
  // Collect values keyed by ifIndex → { metric_column: value }
  const ifMap = new Map();

  for (const oid of ifOids) {
    if (!VALID_METRIC_COLUMNS.has(oid.metric_column)) continue;

    let varbinds;
    try {
      varbinds = await snmpSubtree(session, oid.oid);
    } catch {
      continue; // skip OIDs that fail to walk
    }

    for (const vb of varbinds) {
      // Last element of the returned OID is the ifIndex.
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];

      if (!ifMap.has(ifIndex)) ifMap.set(ifIndex, {});
      ifMap.get(ifIndex)[oid.metric_column] = extractNumericValue(vb);
    }
  }

  for (const [ifIndex, metrics] of ifMap) {
    if (Object.keys(metrics).length > 0) {
      await insertMetricRow(device.id, ifIndex, metrics);
    }
  }
}

/**
 * Insert a single row into snmp_metrics.
 * `metrics` is an object whose keys are valid column names.
 */
async function insertMetricRow(deviceId, interfaceId, metrics) {
  await db.query(
    `INSERT INTO snmp_metrics
       (device_id, interface_id,
        if_in_octets, if_out_octets, if_in_errors, if_out_errors,
        cpu_usage, memory_usage, signal_strength, latency_ms,
        polled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      deviceId,
      interfaceId,
      metrics.if_in_octets ?? null,
      metrics.if_out_octets ?? null,
      metrics.if_in_errors ?? null,
      metrics.if_out_errors ?? null,
      metrics.cpu_usage ?? null,
      metrics.memory_usage ?? null,
      metrics.signal_strength ?? null,
      metrics.latency_ms ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// net-snmp helpers (promise wrappers)
// ---------------------------------------------------------------------------

/** Promisify session.get(). */
function snmpGet(session, oids) {
  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      if (error) return reject(error);
      resolve(varbinds);
    });
  });
}

/** Promisify session.subtree() — walks an OID subtree. */
function snmpSubtree(session, oid) {
  return new Promise((resolve, reject) => {
    const results = [];
    session.subtree(
      oid,
      (varbinds) => {
        for (const vb of varbinds) {
          if (!snmp.isVarbindError(vb)) results.push(vb);
        }
      },
      (error) => {
        if (error) return reject(error);
        resolve(results);
      },
    );
  });
}

/**
 * Extract a numeric value from a varbind, returning null for non-numeric types.
 */
function extractNumericValue(varbind) {
  const raw = varbind.value;
  if (typeof raw === 'number') return raw;
  if (Buffer.isBuffer(raw)) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

module.exports = { poll, pollDevice };
