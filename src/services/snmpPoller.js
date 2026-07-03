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
        await db.query(
          'UPDATE devices SET last_polled_at = NOW(), last_poll_error = NULL WHERE id = ?',
          [device.id],
        ).catch(() => {});
      } else {
        errors++;
        logger.error({ err: result.reason }, 'SNMP poll failed');
        await db.query(
          'UPDATE devices SET last_poll_error = ? WHERE id = ?',
          [String(result.reason?.message || result.reason), device.id],
        ).catch(() => {});
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
     WHERE profile_id = ? AND status = 'active' AND deleted_at IS NULL
     ORDER BY sort_order`,
    [device.snmp_profile_id],
  );

  if (oids.length === 0) return;

  const session = createSnmpSession(device);

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
      metrics.if_in_octets ?? null,
      metrics.if_out_octets ?? null,
      metrics.if_in_errors ?? null,
      metrics.if_out_errors ?? null,
      metrics.cpu_usage ?? null,
      metrics.memory_usage ?? null,
      metrics.signal_strength ?? null,
      metrics.latency_ms ?? null,
      metrics.voltage_mv ?? null,
      metrics.temperature_c ?? null,
      metrics.fan_speed_rpm ?? null,
      metrics.if_in_discards ?? null,
      metrics.if_out_discards ?? null,
      metrics.sfp_tx_power_dbm ?? null,
      metrics.sfp_rx_power_dbm ?? null,
      metrics.sfp_temperature_c ?? null,
      metrics.ups_battery_pct ?? null,
      metrics.ups_runtime_min ?? null,
      metrics.poe_power_mw ?? null,
      metrics.humidity_pct ?? null,
      metrics.if_oper_status ?? null,
      // §9.1 wireless/RF metrics — previously collected but dropped (never in the
      // INSERT list); now persisted. Plus sysUpTime (migration 372).
      metrics.noise_floor_dbm ?? null,
      metrics.air_util_pct ?? null,
      metrics.gps_sync_status ?? null,
      metrics.snr_db ?? null,
      metrics.ccq_pct ?? null,
      metrics.tx_rate_mbps ?? null,
      metrics.rx_rate_mbps ?? null,
      metrics.uptime_ticks ?? null,
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

module.exports = { poll, pollDevice, createSnmpSession, mapAuthProtocol, mapPrivProtocol, resolveSecurityLevel };
