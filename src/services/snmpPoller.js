// =============================================================================
// FireISP 5.0 — SNMP Poller Service
// =============================================================================
// Polls SNMP-enabled devices using their profile OIDs and stores metrics in
// the snmp_metrics wide table.  Each profile OID's metric_column maps directly
// to a column in snmp_metrics (if_in_octets, cpu_usage, signal_strength, …).
// Called by the scheduler/taskRunner on a recurring interval.
//
// §6.1 SNMPv3 support: devices with snmp_version = 'v3' use createV3Session()
// with AES-128/AES-256 privacy and SHA/SHA-256 authentication.  Auth and priv
// passphrases are stored encrypted (AES-256-GCM via src/utils/encryption.js)
// and decrypted at runtime so they are never kept in plain-text at rest.
// =============================================================================

const snmp = require('net-snmp');
const db = require('../config/database');
const { decrypt } = require('../utils/encryption');
const deviceStatusService = require('./deviceStatusService');
const logger = require('../utils/logger').child({ service: 'snmpPoller' });

// Columns in snmp_metrics that a profile OID may target.
// Includes base columns (migrations 001-248) and §6.2 extended metrics (migration 255).
const VALID_METRIC_COLUMNS = new Set([
  // §6.0 base metrics
  'if_in_octets',
  'if_out_octets',
  'if_in_errors',
  'if_out_errors',
  'cpu_usage',
  'memory_usage',
  'signal_strength',
  'latency_ms',
  // §6.2 extended device monitoring metrics
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
  // §6.2 gap metrics (migration 264)
  'if_oper_status',
  // §9.1 wireless/RF metrics (migration 279)
  'noise_floor_dbm',
  'air_util_pct',
  'gps_sync_status',
  'snr_db',
  'ccq_pct',
  'tx_rate_mbps',
  'rx_rate_mbps',
  // §uptime — SNMP sysUpTime (migration 372)
  'uptime_ticks',
]);

// -----------------------------------------------------------------------------
// Per-column value bounds, derived from the snmp_metrics column types in
// database/schema.sql (~:1553-1588). insertMetricRow() nulls any value that
// falls outside these ranges instead of letting a raw SNMP value overflow its
// column and throw a MySQL "Out of range" error — that used to abort the
// *entire* pollDevice() call (migration 398 fixed the concrete case: raw
// hrStorageUsed storage-allocation units mapped straight into the SMALLINT
// memory_usage "percentage" column).
//
// Every key in VALID_METRIC_COLUMNS must have exactly one entry here.
// -----------------------------------------------------------------------------
const METRIC_COLUMN_BOUNDS = {
  // BIGINT, signed 64-bit (schema.sql:1557-1560,1569-1570,1588). JS doubles
  // only carry 53 bits of integer precision, so the practical ceiling is
  // Number.MAX_SAFE_INTEGER rather than the true BIGINT max — real counters
  // never approach either before wrapping in SNMP itself.
  if_in_octets:       { min: 0, max: Number.MAX_SAFE_INTEGER },
  if_out_octets:      { min: 0, max: Number.MAX_SAFE_INTEGER },
  if_in_errors:       { min: 0, max: Number.MAX_SAFE_INTEGER },
  if_out_errors:      { min: 0, max: Number.MAX_SAFE_INTEGER },
  if_in_discards:     { min: 0, max: Number.MAX_SAFE_INTEGER },
  if_out_discards:    { min: 0, max: Number.MAX_SAFE_INTEGER },
  uptime_ticks:       { min: 0, max: Number.MAX_SAFE_INTEGER },

  // SMALLINT, signed 16-bit (schema.sql:1561-1562,1574,1581,1584-1585)
  cpu_usage:          { min: -32768, max: 32767 },
  memory_usage:       { min: -32768, max: 32767 },
  ups_battery_pct:    { min: -32768, max: 32767 },
  noise_floor_dbm:    { min: -32768, max: 32767 },
  snr_db:             { min: -32768, max: 32767 },
  ccq_pct:            { min: -32768, max: 32767 },

  // TINYINT, signed 8-bit (schema.sql:1579,1582-1583)
  if_oper_status:     { min: -128, max: 127 },
  air_util_pct:       { min: -128, max: 127 },
  gps_sync_status:    { min: -128, max: 127 },

  // INT/INTEGER, signed 32-bit (schema.sql:1563,1566,1568,1575-1576)
  signal_strength:    { min: -2147483648, max: 2147483647 },
  voltage_mv:         { min: -2147483648, max: 2147483647 },
  fan_speed_rpm:      { min: -2147483648, max: 2147483647 },
  ups_runtime_min:    { min: -2147483648, max: 2147483647 },
  poe_power_mw:       { min: -2147483648, max: 2147483647 },

  // DECIMAL(p,s) — max magnitude is (10^(p-s) - 1) + (1 - 10^-s)
  latency_ms:         { min: -99999999.99, max: 99999999.99 },   // DECIMAL(10,2), schema.sql:1564
  temperature_c:      { min: -9999.99, max: 9999.99 },           // DECIMAL(6,2), schema.sql:1567
  sfp_tx_power_dbm:   { min: -9999.9999, max: 9999.9999 },       // DECIMAL(8,4), schema.sql:1571
  sfp_rx_power_dbm:   { min: -9999.9999, max: 9999.9999 },       // DECIMAL(8,4), schema.sql:1572
  sfp_temperature_c:  { min: -9999.99, max: 9999.99 },           // DECIMAL(6,2), schema.sql:1573
  humidity_pct:       { min: -999.99, max: 999.99 },             // DECIMAL(5,2), schema.sql:1577
  tx_rate_mbps:       { min: -999999.99, max: 999999.99 },       // DECIMAL(8,2), schema.sql:1586
  rx_rate_mbps:       { min: -999999.99, max: 999999.99 },       // DECIMAL(8,2), schema.sql:1587
};

// Configurable concurrency for parallel polling (default: 10 devices at a time)
const POLL_CONCURRENCY = parseInt(process.env.SNMP_POLL_CONCURRENCY || '10', 10);

/**
 * Poll all SNMP-enabled devices.
 * Returns { polled, errors, total }.
 */
async function poll() {
  const [devices] = await db.query(`
    SELECT d.id, d.ip_address, d.snmp_community, d.snmp_version, d.snmp_port,
           d.snmp_profile_id,
           d.snmp_v3_security_name, d.snmp_v3_auth_protocol,
           d.snmp_v3_auth_key_encrypted, d.snmp_v3_priv_protocol,
           d.snmp_v3_priv_key_encrypted, d.snmp_v3_context_name
    FROM devices d
    WHERE d.snmp_enabled = 1
      AND d.ip_address IS NOT NULL
      AND d.snmp_profile_id IS NOT NULL
      AND d.deleted_at IS NULL
  `);

  let polled = 0;
  let errors = 0;

  // Poll devices in batches for parallel execution
  for (let i = 0; i < devices.length; i += POLL_CONCURRENCY) {
    const batch = devices.slice(i, i + POLL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(device => pollDevice(device).then(() => device.id)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const device = batch[j];
      if (result.status === 'fulfilled') {
        polled++;
        await deviceStatusService.recordPollResult(device.id, true)
          .catch(err2 => logger.warn({ err: err2, deviceId: device.id }, 'recordPollResult (success) failed'));
      } else {
        errors++;
        logger.error({ err: result.reason }, 'SNMP poll failed');
        await deviceStatusService.recordPollResult(device.id, false, String(result.reason?.message || result.reason))
          .catch(err2 => logger.warn({ err: err2, deviceId: device.id }, 'recordPollResult (failure) failed'));
      }
    }
  }

  return { polled, errors, total: devices.length };
}

/**
 * Poll a single device for all OIDs defined in its SNMP profile and write one
 * row per device (scalar metrics) plus one row per interface (per-interface
 * metrics) into snmp_metrics.
 *
 * Reachability is tracked positively: pollDevice only succeeds if at least
 * one varbind actually responded (scalar GET or interface subtree walk) —
 * presence-based via snmp.isVarbindError(), never value-based, so e.g. a
 * freshly-rebooted device reporting sysUpTime=0 still counts as reachable.
 * A metric-ingest failure (bad value, DB error) is a completely separate
 * concern from reachability and must never be conflated with it — see
 * insertMetricRow()'s per-column sanitation and the scalar insert's own
 * try/catch below.
 */
async function pollDevice(device) {
  const [oids] = await db.query(
    `SELECT id, oid, metric_column, label, oid_type, is_per_interface, transform
     FROM snmp_profile_oids
     WHERE profile_id = ? AND status = 'active' AND deleted_at IS NULL
     ORDER BY sort_order`,
    [device.snmp_profile_id],
  );

  if (oids.length === 0) return;

  const session = createSnmpSession(device);
  let respondedCount = 0;

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

        // Presence-based: this OID answered, regardless of its value.
        respondedCount++;

        if (!VALID_METRIC_COLUMNS.has(oid.metric_column)) continue;

        const rawValue = extractNumericValue(varbind);
        scalarRow[oid.metric_column] = applyTransform(rawValue, oid.transform);
      }
    }

    // Insert a device-level row when we have at least one scalar metric.
    // Wrapped in its own try/catch: an ingest/DB failure here (e.g. a value
    // that still doesn't fit its column, or a transient DB error) must never
    // abort per-interface polling below, and must never be mistaken for the
    // device being unreachable.
    if (Object.keys(scalarRow).length > 0) {
      try {
        await insertMetricRow(device.id, null, scalarRow);
      } catch (err) {
        logger.error({ err, deviceId: device.id }, 'pollDevice: scalar metric ingest failed (device still reachable)');
      }
    }

    // --- Per-interface metrics ---------------------------------------------
    if (ifOids.length > 0) {
      respondedCount += await pollInterfaces(session, device, ifOids);
    }

    if (respondedCount === 0) {
      throw new Error('device unreachable: no OIDs responded');
    }
  } finally {
    session.close();
  }
}

/**
 * Walk the interface table for per-interface OIDs and insert one row per
 * interface into snmp_metrics. Returns the number of varbinds that actually
 * responded across all walked OIDs (for pollDevice's reachability tally) —
 * snmpSubtree() already filters out isVarbindError entries, so every
 * returned varbind is a real response.
 */
async function pollInterfaces(session, device, ifOids) {
  // Collect values keyed by ifIndex → { metric_column: value }
  const ifMap = new Map();
  let respondedCount = 0;

  for (const oid of ifOids) {
    if (!VALID_METRIC_COLUMNS.has(oid.metric_column)) continue;

    let varbinds;
    try {
      varbinds = await snmpSubtree(session, oid.oid);
    } catch (err) {
      logger.warn(
        { err, deviceId: device.id, oid: oid.oid, metricColumn: oid.metric_column },
        'pollInterfaces: OID subtree walk failed, skipping this metric',
      );
      continue;
    }

    respondedCount += varbinds.length;

    for (const vb of varbinds) {
      // Last element of the returned OID is the ifIndex.
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];

      if (!ifMap.has(ifIndex)) ifMap.set(ifIndex, {});
      const rawValue = extractNumericValue(vb);
      ifMap.get(ifIndex)[oid.metric_column] = applyTransform(rawValue, oid.transform);
    }
  }

  for (const [ifIndex, metrics] of ifMap) {
    if (Object.keys(metrics).length > 0) {
      try {
        await insertMetricRow(device.id, ifIndex, metrics);
      } catch (err) {
        logger.error(
          { err, deviceId: device.id, interfaceId: ifIndex },
          'pollInterfaces: metric ingest failed for interface (device still reachable)',
        );
      }
    }
  }

  return respondedCount;
}

/**
 * Validate a metrics object against METRIC_COLUMN_BOUNDS before it is bound
 * into the INSERT. Out-of-range or non-finite values are nulled — never
 * thrown — so a single bad OID/profile mapping (the root cause of the
 * hrStorageUsed → memory_usage bug fixed by migration 398) can never abort
 * the whole row. Warns once per offending column per row.
 */
function sanitizeMetrics(deviceId, interfaceId, metrics) {
  const clean = { ...metrics };
  for (const [column, value] of Object.entries(clean)) {
    if (value === null || value === undefined) continue;

    const bounds = METRIC_COLUMN_BOUNDS[column];
    if (!bounds) continue; // not expected — VALID_METRIC_COLUMNS covers every key

    if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
      logger.warn(
        { deviceId, interfaceId, column, value },
        'snmpPoller: metric value out of range for its column, discarding',
      );
      clean[column] = null;
    }
  }
  return clean;
}

/**
 * Insert a single row into snmp_metrics.
 * `metrics` is an object whose keys are valid column names.
 */
async function insertMetricRow(deviceId, interfaceId, metrics) {
  const safe = sanitizeMetrics(deviceId, interfaceId, metrics);
  await db.query(
    `INSERT INTO snmp_metrics
       (device_id, interface_id,
        if_in_octets, if_out_octets, if_in_errors, if_out_errors,
        cpu_usage, memory_usage, signal_strength, latency_ms,
        voltage_mv, temperature_c, fan_speed_rpm,
        if_in_discards, if_out_discards,
        sfp_tx_power_dbm, sfp_rx_power_dbm, sfp_temperature_c,
        ups_battery_pct, ups_runtime_min, poe_power_mw, humidity_pct,
        if_oper_status,
        noise_floor_dbm, air_util_pct, gps_sync_status, snr_db, ccq_pct,
        tx_rate_mbps, rx_rate_mbps,
        uptime_ticks,
        polled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      deviceId,
      interfaceId,
      safe.if_in_octets ?? null,
      safe.if_out_octets ?? null,
      safe.if_in_errors ?? null,
      safe.if_out_errors ?? null,
      safe.cpu_usage ?? null,
      safe.memory_usage ?? null,
      safe.signal_strength ?? null,
      safe.latency_ms ?? null,
      safe.voltage_mv ?? null,
      safe.temperature_c ?? null,
      safe.fan_speed_rpm ?? null,
      safe.if_in_discards ?? null,
      safe.if_out_discards ?? null,
      safe.sfp_tx_power_dbm ?? null,
      safe.sfp_rx_power_dbm ?? null,
      safe.sfp_temperature_c ?? null,
      safe.ups_battery_pct ?? null,
      safe.ups_runtime_min ?? null,
      safe.poe_power_mw ?? null,
      safe.humidity_pct ?? null,
      safe.if_oper_status ?? null,
      // §9.1 wireless/RF metrics — previously collected but dropped (never in the
      // INSERT list); now persisted. Plus sysUpTime (migration 372).
      safe.noise_floor_dbm ?? null,
      safe.air_util_pct ?? null,
      safe.gps_sync_status ?? null,
      safe.snr_db ?? null,
      safe.ccq_pct ?? null,
      safe.tx_rate_mbps ?? null,
      safe.rx_rate_mbps ?? null,
      safe.uptime_ticks ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// SNMPv3 protocol mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map the devices.snmp_v3_auth_protocol ENUM value to a net-snmp
 * AuthProtocols constant.  Falls back to SHA (the column default).
 */
function mapAuthProtocol(proto) {
  switch ((proto || 'sha').toLowerCase()) {
    case 'md5':    return snmp.AuthProtocols.md5;
    case 'sha256': return snmp.AuthProtocols.sha256;
    case 'sha512': return snmp.AuthProtocols.sha512;
    case 'none':   return snmp.AuthProtocols.none;
    case 'sha':
    default:       return snmp.AuthProtocols.sha;
  }
}

/**
 * Map the devices.snmp_v3_priv_protocol ENUM value to a net-snmp
 * PrivProtocols constant.  Falls back to AES-128 (the column default).
 */
function mapPrivProtocol(proto) {
  switch ((proto || 'aes128').toLowerCase()) {
    case 'des':    return snmp.PrivProtocols.des;
    case 'aes256': return snmp.PrivProtocols.aes256b;  // AES-256 (Blumenthal)
    case 'none':   return snmp.PrivProtocols.none;
    case 'aes128':
    default:       return snmp.PrivProtocols.aes;       // AES-128 (RFC 3826)
  }
}

/**
 * Determine the SNMPv3 security level based on which credentials are present.
 *   - both auth + priv keys present  → authPriv
 *   - only auth key present          → authNoPriv
 *   - neither                        → noAuthNoPriv
 */
function resolveSecurityLevel(authKey, privKey, authProto, privProto) {
  const hasAuth = !!authKey && authProto !== 'none';
  const hasPriv = !!privKey && privProto !== 'none';
  if (hasAuth && hasPriv) return snmp.SecurityLevel.authPriv;
  if (hasAuth)            return snmp.SecurityLevel.authNoPriv;
  return snmp.SecurityLevel.noAuthNoPriv;
}

/**
 * Create a net-snmp session for the given device row.
 * Handles SNMPv1, v2c, and v3 transparently.
 *
 * For v3: decrypts the stored AES-256-GCM ciphertext for auth/priv keys.
 * The decrypted keys are kept in local scope and never written to the DB.
 */
function createSnmpSession(device) {
  const port    = device.snmp_port || 161;
  const timeout = 5000;
  const retries = 1;

  if (device.snmp_version === 'v3') {
    const secName  = device.snmp_v3_security_name || 'firesipv3';
    const authProto = device.snmp_v3_auth_protocol || 'sha';
    const privProto = device.snmp_v3_priv_protocol || 'aes128';

    // Decrypt at-rest credentials — returns plaintext (or the raw value when
    // ENCRYPTION_KEY is not set, which is fine for dev/test environments).
    const authKey = device.snmp_v3_auth_key_encrypted
      ? decrypt(device.snmp_v3_auth_key_encrypted)
      : '';
    const privKey = device.snmp_v3_priv_key_encrypted
      ? decrypt(device.snmp_v3_priv_key_encrypted)
      : '';

    const level = resolveSecurityLevel(authKey, privKey, authProto, privProto);

    const user = {
      name:          secName,
      level,
      authProtocol:  mapAuthProtocol(authProto),
      authKey,
      privProtocol:  mapPrivProtocol(privProto),
      privKey,
    };

    return snmp.createV3Session(device.ip_address, user, {
      port,
      timeout,
      retries,
      context: device.snmp_v3_context_name || '',
    });
  }

  // SNMPv1 / SNMPv2c
  const version = device.snmp_version === 'v1' ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(device.ip_address, device.snmp_community || 'public', {
    port,
    version,
    timeout,
    retries,
  });
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

// Recognizes only "value / <number>" and "value * <number>" (whitespace
// tolerant, optional leading minus on the operand). Anything else is rejected.
const TRANSFORM_EXPR = /^\s*value\s*([/*])\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Apply a profile OID's optional `transform` expression (snmp_profile_oids
 * .transform, schema.sql:1992) to a raw numeric value.
 *
 * SECURITY: `transform` is admin/API-editable free text — this function must
 * NEVER eval() or `new Function()` it. Only the two whitelisted forms above
 * are recognized; anything else (garbage, or an injection attempt) is
 * rejected, logged once, and the raw value is returned unchanged.
 */
function applyTransform(value, expr) {
  if (value === null || value === undefined || !Number.isFinite(value) || !expr) {
    return value;
  }

  const match = TRANSFORM_EXPR.exec(expr);
  if (!match) {
    logger.warn({ expr }, 'applyTransform: unrecognized transform expression, using raw value');
    return value;
  }

  const [, operator, operandStr] = match;
  const operand = Number(operandStr);
  if (!Number.isFinite(operand) || (operator === '/' && operand === 0)) {
    logger.warn({ expr }, 'applyTransform: invalid transform operand, using raw value');
    return value;
  }

  return operator === '/' ? value / operand : value * operand;
}

module.exports = {
  poll,
  pollDevice,
  createSnmpSession,
  mapAuthProtocol,
  mapPrivProtocol,
  resolveSecurityLevel,
  applyTransform,
  sanitizeMetrics,
  METRIC_COLUMN_BOUNDS,
};
