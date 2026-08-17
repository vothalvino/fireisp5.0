// =============================================================================
// FireISP 5.0 — SNMP Trap Receiver Service
// =============================================================================
// Listens on a UDP port for unsolicited SNMP trap messages (v1 and v2c)
// from network devices, stores them in the snmp_traps table, and fires
// event-bus notifications so alert/notification hooks can react.
//
// Configuration (env vars):
//   SNMP_TRAP_PORT  UDP port to listen on (default: 1620)
//                   Use 162 only when running as root; otherwise 1620 or any
//                   port ≥ 1024.  Forward with: iptables -t nat -A PREROUTING
//                   -p udp --dport 162 -j REDIRECT --to-port 1620
//   SNMP_TRAP_BIND_IP IPv4 address to bind (default: 127.0.0.1). Use
//                   0.0.0.0 only behind a trusted network ACL.
//
// Standard trap-type OIDs (IETF RFC 3418 / SNMPv2-MIB):
//   coldStart            1.3.6.1.6.3.1.1.5.1
//   warmStart            1.3.6.1.6.3.1.1.5.2
//   linkDown             1.3.6.1.6.3.1.1.5.3
//   linkUp               1.3.6.1.6.3.1.1.5.4
//   authenticationFailure 1.3.6.1.6.3.1.1.5.5
//   egpNeighborLoss      1.3.6.1.6.3.1.1.5.6
// =============================================================================

const snmp = require('net-snmp');
const net = require('net');
const config = require('../config');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'snmpTrapReceiver' });
const eventBus = require('./eventBus');
const { normalizeIpAddress } = require('../utils/ipAddress');
const {
  checkPrimarySchemaReadiness,
  checkSchemaReadiness,
} = require('./trapForwardingReadinessService');

function boundedEnvInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw).trim())) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

function configuredTrapPort() {
  const raw = String(process.env.SNMP_TRAP_PORT || '1620').trim();
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function configuredTrapBindIp() {
  const value = String(process.env.SNMP_TRAP_BIND_IP || '127.0.0.1').trim();
  return net.isIP(value) === 4 ? value : null;
}

function safeReceiverError(error) {
  const code = /^[A-Z0-9_.:-]{1,64}$/.test(String(error?.code || ''))
    ? String(error.code)
    : null;
  const name = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(String(error?.name || ''))
    ? String(error.name)
    : 'Error';
  // net-snmp ProcessingError objects may retain the original UDP buffer,
  // rinfo, and nested cause. Never hand the object/message to Pino: a v1/v2c
  // community or varbind value can be present in those fields.
  return { error_name: name, error_code: code };
}

const MAX_IN_FLIGHT = boundedEnvInt('SNMP_TRAP_MAX_IN_FLIGHT', 16, 1, 128);
const RATE_PER_SECOND = boundedEnvInt('SNMP_TRAP_RATE_PER_SECOND', 50, 1, 1000);
const RATE_BURST = boundedEnvInt('SNMP_TRAP_RATE_BURST', 100, 1, 2000);
const RATE_PER_MINUTE = boundedEnvInt('SNMP_TRAP_RATE_PER_MINUTE', 600, 1, 6000);
const RATE_MINUTE_BURST = boundedEnvInt('SNMP_TRAP_RATE_MINUTE_BURST', 120, 1, 12000);
const SOURCE_RATE_PER_MINUTE = boundedEnvInt('SNMP_TRAP_SOURCE_RATE_PER_MINUTE', 10, 1, 600);
const SOURCE_RATE_BURST = boundedEnvInt('SNMP_TRAP_SOURCE_RATE_BURST', 20, 1, 1200);
const SOURCE_RATE_BUCKETS = 256;
const DRAIN_TIMEOUT_MS = boundedEnvInt('SNMP_TRAP_DRAIN_TIMEOUT_MS', 10000, 1000, 60000);
const MAX_VARBIND_COUNT = 64;
const MAX_VARBIND_VALUE_BYTES = 512;
const MAX_VARBINDS_JSON_BYTES = 8 * 1024;
const ORG_DAILY_TRAP_ROW_LIMIT = boundedEnvInt('SNMP_TRAP_ORG_DAILY_ROW_LIMIT', 10000, 1, 1000000);
const GLOBAL_DAILY_TRAP_ROW_LIMIT = boundedEnvInt('SNMP_TRAP_GLOBAL_DAILY_ROW_LIMIT', 100000, 1, 10000000);
const ORG_DAILY_VARBIND_BYTE_LIMIT = boundedEnvInt(
  'SNMP_TRAP_ORG_DAILY_VARBIND_BYTES',
  16 * 1024 * 1024,
  1,
  1024 * 1024 * 1024,
);
const GLOBAL_DAILY_VARBIND_BYTE_LIMIT = boundedEnvInt(
  'SNMP_TRAP_GLOBAL_DAILY_VARBIND_BYTES',
  128 * 1024 * 1024,
  1,
  4 * 1024 * 1024 * 1024,
);
const ORG_DAILY_DELIVERY_LIMIT = boundedEnvInt(
  'SNMP_TRAP_ORG_DAILY_DELIVERY_LIMIT', 10000, 1, 1000000,
);
const GLOBAL_DAILY_DELIVERY_LIMIT = boundedEnvInt(
  'SNMP_TRAP_GLOBAL_DAILY_DELIVERY_LIMIT', 100000, 1, 10000000,
);
// Backward-compatible export aliases; new code and deployment config use the
// explicit organization/global names above.
const DAILY_TRAP_ROW_LIMIT = ORG_DAILY_TRAP_ROW_LIMIT;
const DAILY_VARBIND_BYTE_LIMIT = ORG_DAILY_VARBIND_BYTE_LIMIT;

// OID present in every SNMPv2c/v3 TrapV2-PDU — carries the actual trap OID value
const SNMP_TRAP_OID_VARBIND = '1.3.6.1.6.3.1.1.4.1.0';

// Well-known trap-type labels keyed by their SNMPv2 OID
const SNMP_TRAP_OID_MAP = {
  '1.3.6.1.6.3.1.1.5.1': 'coldStart',
  '1.3.6.1.6.3.1.1.5.2': 'warmStart',
  '1.3.6.1.6.3.1.1.5.3': 'linkDown',
  '1.3.6.1.6.3.1.1.5.4': 'linkUp',
  '1.3.6.1.6.3.1.1.5.5': 'authenticationFailure',
  '1.3.6.1.6.3.1.1.5.6': 'egpNeighborLoss',
};

// SNMPv1 generic-trap integer → label mapping (RFC 1157 §4.1.6)
const V1_GENERIC_TRAP_MAP = [
  'coldStart',           // 0
  'warmStart',           // 1
  'linkDown',            // 2
  'linkUp',              // 3
  'authenticationFailure', // 4
  'egpNeighborLoss',     // 5
  // 6 = enterpriseSpecific (handled separately)
];

let receiver = null;
let bindingReceiver = null;
let startPromise = null;
let stopPromise = null;
let lifecycleGeneration = 0;
let accepting = false;
const inFlight = new Set();
let rateTokens = RATE_BURST;
let rateRefilledAt = Date.now();
let minuteRateTokens = RATE_MINUTE_BURST;
let minuteRateRefilledAt = Date.now();
const sourceRateBuckets = Array.from({ length: SOURCE_RATE_BUCKETS }, () => ({
  key: null,
  tokens: SOURCE_RATE_BURST,
  refilledAt: Date.now(),
  lastUsed: 0,
}));
let sourceRateSequence = 0;
const receiverStatus = {
  enabled: Boolean(config.features.snmp),
  configured: true,
  port: configuredTrapPort(),
  bind_ip: configuredTrapBindIp(),
  state: 'stopped',
  listening: false,
  ready: false,
  reason: 'stopped',
  attribution_ready: false,
  attribution_reason: 'listener_not_ready',
  accepted_total: 0,
  dropped_overload_total: 0,
  dropped_rate_total: 0,
  dropped_source_rate_total: 0,
  dropped_unattributed_total: 0,
  dropped_daily_quota_total: 0,
  metadata_only_daily_quota_total: 0,
  forwarding_skipped_daily_quota_total: 0,
  processing_errors_total: 0,
};

// ---------------------------------------------------------------------------
// Device lookup
// ---------------------------------------------------------------------------

/**
 * Look up a device by its management IP address.
 * Returns { id, organization_id, name } only when the address identifies one
 * unambiguous device. Management IPs commonly repeat across tenants; choosing
 * an arbitrary LIMIT 1 row would forward one ISP's trap into another ISP's
 * organization. Ambiguous/unowned sources therefore fail closed as null.
 */
async function lookupDevice(sourceIp) {
  // Production supports isolated tenant databases. Resolve through the same
  // fail-closed routing pattern as the embedded RADIUS server; unit/custom DB
  // adapters without tenant-context methods retain the strict shared lookup.
  if (typeof db.withPrimaryContext === 'function' && typeof db.withTenantContext === 'function') {
    const { resolveDeviceByIp } = require('./tenantDeviceResolverService');
    const resolution = await resolveDeviceByIp(sourceIp);
    if (resolution.ambiguous) {
      logger.warn({ sourceIp, matches: resolution.matches }, 'SNMP trap source IP is ambiguous; dropping without persistence');
    } else if (resolution.incomplete) {
      logger.warn(
        { sourceIp, reason: resolution.reason },
        'SNMP trap device routing is unavailable; dropping without persistence',
      );
    }
    return resolution.device;
  }

  const [rows] = await db.query(
    `SELECT d.id, d.organization_id, d.name
       FROM devices d
       JOIN organizations o
         ON o.id = d.organization_id
        AND o.status = 'active' AND o.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
        AND INET6_ATON(d.ip_address) = INET6_ATON(?)
      ORDER BY d.id ASC
      LIMIT 2`,
    [sourceIp],
  );
  if (rows.length !== 1) {
    if (rows.length > 1) {
      logger.warn({ sourceIp, matches: rows.length }, 'SNMP trap source IP is ambiguous; dropping without persistence');
    }
    return null;
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Database storage
// ---------------------------------------------------------------------------

/**
 * Insert one trap row into snmp_traps and return its new ID.
 */
async function storeTrap({
  organizationId,
  deviceId,
  sourceIp,
  trapType,
  trapOid,
  varbinds,
  snmpVersion,
  varbindsTruncated,
  varbindsOriginalCount,
  varbindsTruncationReason,
}, exec = db.query) {
  const bounded = boundedVarbindPayload(Array.isArray(varbinds) ? varbinds : []);
  const collectionTruncated = varbindsTruncated === undefined
    ? bounded.truncated
    : Boolean(varbindsTruncated);
  const originalCount = Number.isSafeInteger(Number(varbindsOriginalCount))
    ? Math.max(0, Math.min(65535, Number(varbindsOriginalCount)))
    : bounded.original_count;
  const truncationReason = collectionTruncated
    ? (varbindsTruncationReason || bounded.truncation_reason || 'size_limit')
    : null;
  const [result] = await exec(
    `INSERT INTO snmp_traps
       (organization_id, device_id, source_ip, trap_type, trap_oid,
        varbinds, varbinds_truncated, varbinds_original_count,
        varbinds_truncation_reason, snmp_version, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      organizationId || null,
      deviceId        || null,
      sourceIp,
      trapType,
      trapOid         || null,
      bounded.json,
      collectionTruncated ? 1 : 0,
      originalCount,
      truncationReason,
      snmpVersion     || 2,
    ],
  );
  return result.insertId;
}

// ---------------------------------------------------------------------------
// Trap parsing helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a single varbind to a plain-object safe for JSON storage.
 * Buffers are hex-encoded; everything else is coerced to string.
 */
function truncateUtf8(value, maxBytes) {
  const buffer = Buffer.from(String(value), 'utf8');
  if (buffer.length <= maxBytes) return { value: String(value), truncated: false };
  let end = maxBytes;
  let output = buffer.subarray(0, end).toString('utf8');
  while (Buffer.byteLength(output, 'utf8') > maxBytes && end > 0) {
    end -= 1;
    output = buffer.subarray(0, end).toString('utf8');
  }
  return { value: output, truncated: true };
}

function serializeVarbind(vb = {}) {
  if (!vb || typeof vb !== 'object') vb = { value: vb };
  let value = vb.value;
  let truncated = vb.truncated === true;
  if (Buffer.isBuffer(value)) {
    const maxBufferBytes = Math.floor(MAX_VARBIND_VALUE_BYTES / 2);
    truncated = truncated || value.length > maxBufferBytes;
    value = value.subarray(0, maxBufferBytes).toString('hex');
  } else if (value !== null && value !== undefined) {
    const bounded = truncateUtf8(value, MAX_VARBIND_VALUE_BYTES);
    value = bounded.value;
    truncated = truncated || bounded.truncated;
  }
  const oid = truncateUtf8(vb.oid || '', 255);
  const type = vb.type === null || vb.type === undefined
    ? null
    : (typeof vb.type === 'number' && Number.isFinite(vb.type)
      ? vb.type
      : truncateUtf8(vb.type, 32).value);
  const result = { oid: oid.value, type, value };
  if (truncated || oid.truncated) result.truncated = true;
  return result;
}

function serializeVarbinds(rawVarbinds) {
  const source = Array.isArray(rawVarbinds) ? rawVarbinds : [];
  const candidates = source.slice(0, MAX_VARBIND_COUNT).map(serializeVarbind);
  const output = [];
  let bytes = 2; // []
  for (const candidate of candidates) {
    const encoded = JSON.stringify(candidate);
    const candidateBytes = Buffer.byteLength(encoded, 'utf8') + (output.length ? 1 : 0);
    if (bytes + candidateBytes > MAX_VARBINDS_JSON_BYTES) break;
    output.push(candidate);
    bytes += candidateBytes;
  }
  return output;
}

function boundedVarbindPayload(rawVarbinds) {
  const source = Array.isArray(rawVarbinds) ? rawVarbinds : [];
  const varbinds = serializeVarbinds(rawVarbinds);
  const json = JSON.stringify(varbinds);
  const countLimited = source.length > MAX_VARBIND_COUNT;
  const byteLimited = varbinds.length < Math.min(source.length, MAX_VARBIND_COUNT);
  const truncationReason = countLimited && byteLimited
    ? 'count_and_size_limit'
    : (countLimited ? 'count_limit' : (byteLimited ? 'size_limit' : null));
  return {
    varbinds,
    json,
    bytes: Buffer.byteLength(json, 'utf8'),
    original_count: Math.min(65535, source.length),
    truncated: countLimited || byteLimited,
    truncation_reason: truncationReason,
  };
}

/**
 * Reserve one UTC-day ingest slot while the caller holds its primary DB
 * transaction. Global then organization rows are locked in deterministic
 * order, providing tenant fairness and a separate install-wide hard ceiling.
 */
async function reserveTrapIngestUsage(exec, organizationId, requestedVarbindBytes = 0) {
  const orgId = Number(organizationId);
  if (!Number.isSafeInteger(orgId) || orgId < 1) {
    throw new TypeError('organizationId must be a positive integer');
  }
  const requestedBytes = Math.max(0, Math.min(
    MAX_VARBINDS_JSON_BYTES,
    Number.isSafeInteger(Number(requestedVarbindBytes)) ? Number(requestedVarbindBytes) : 0,
  ));
  await exec(
    `INSERT IGNORE INTO snmp_trap_ingest_daily_usage
       (usage_date, scope_type, scope_id, trap_count, varbind_bytes,
        delivery_count, metadata_only_count, dropped_trap_count, forwarding_skipped_count)
     VALUES
       (UTC_DATE(), 'global', 0, 0, 0, 0, 0, 0, 0),
       (UTC_DATE(), 'organization', ?, 0, 0, 0, 0, 0, 0)`,
    [orgId],
  );
  const [rows] = await exec(
    `SELECT usage_date, scope_type, scope_id, trap_count, varbind_bytes,
            delivery_count, metadata_only_count, dropped_trap_count,
            forwarding_skipped_count
       FROM snmp_trap_ingest_daily_usage
      WHERE usage_date = UTC_DATE()
        AND ((scope_type = 'global' AND scope_id = 0)
          OR (scope_type = 'organization' AND scope_id = ?))
      ORDER BY scope_type ASC, scope_id ASC
      FOR UPDATE`,
    [orgId],
  );
  const global = rows.find(row => row.scope_type === 'global' && Number(row.scope_id) === 0);
  const organization = rows.find(row => (
    row.scope_type === 'organization' && Number(row.scope_id) === orgId
  ));
  if (!global || !organization) throw new Error('SNMP trap daily ingest quota rows are unavailable');

  const orgTrapCount = Number(organization.trap_count || 0);
  const globalTrapCount = Number(global.trap_count || 0);
  const orgVarbindBytes = Number(organization.varbind_bytes || 0);
  const globalVarbindBytes = Number(global.varbind_bytes || 0);
  if (orgTrapCount >= ORG_DAILY_TRAP_ROW_LIMIT
      || globalTrapCount >= GLOBAL_DAILY_TRAP_ROW_LIMIT) {
    await exec(
      `UPDATE snmp_trap_ingest_daily_usage
          SET dropped_trap_count = dropped_trap_count + 1
        WHERE usage_date = UTC_DATE()
          AND ((scope_type = 'global' AND scope_id = 0)
            OR (scope_type = 'organization' AND scope_id = ?))`,
      [orgId],
    );
    return {
      accepted: false,
      store_varbinds: false,
      reason: 'daily_trap_row_limit',
      usage_date: organization.usage_date,
      trap_count: orgTrapCount,
      varbind_bytes: orgVarbindBytes,
      global: { trap_count: globalTrapCount, varbind_bytes: globalVarbindBytes },
    };
  }

  const storeVarbinds = requestedBytes === 0
    || (orgVarbindBytes + requestedBytes <= ORG_DAILY_VARBIND_BYTE_LIMIT
      && globalVarbindBytes + requestedBytes <= GLOBAL_DAILY_VARBIND_BYTE_LIMIT);
  const storedBytes = storeVarbinds ? requestedBytes : 0;
  await exec(
    `UPDATE snmp_trap_ingest_daily_usage
        SET trap_count = trap_count + 1,
            varbind_bytes = varbind_bytes + ?,
            metadata_only_count = metadata_only_count + ?
      WHERE usage_date = UTC_DATE()
        AND ((scope_type = 'global' AND scope_id = 0)
          OR (scope_type = 'organization' AND scope_id = ?))`,
    [storedBytes, storeVarbinds ? 0 : 1, orgId],
  );
  return {
    accepted: true,
    store_varbinds: storeVarbinds,
    reason: storeVarbinds ? null : 'daily_varbind_byte_limit',
    usage_date: organization.usage_date,
    trap_count: orgTrapCount + 1,
    varbind_bytes: orgVarbindBytes + storedBytes,
    global: {
      trap_count: globalTrapCount + 1,
      varbind_bytes: globalVarbindBytes + storedBytes,
    },
  };
}

async function reserveTrapForwardingUsage(exec, organizationId, requestedDeliveries) {
  const orgId = Number(organizationId);
  const requested = Math.max(0, Math.min(100, Number(requestedDeliveries) || 0));
  if (!Number.isSafeInteger(orgId) || orgId < 1) {
    throw new TypeError('organizationId must be a positive integer');
  }
  if (!requested) return { allowed_count: 0, skipped_count: 0, reason: null };

  const [rows] = await exec(
    `SELECT scope_type, scope_id, delivery_count
       FROM snmp_trap_ingest_daily_usage
      WHERE usage_date = UTC_DATE()
        AND ((scope_type = 'global' AND scope_id = 0)
          OR (scope_type = 'organization' AND scope_id = ?))
      ORDER BY scope_type ASC, scope_id ASC
      FOR UPDATE`,
    [orgId],
  );
  const global = rows.find(row => row.scope_type === 'global' && Number(row.scope_id) === 0);
  const organization = rows.find(row => (
    row.scope_type === 'organization' && Number(row.scope_id) === orgId
  ));
  if (!global || !organization) throw new Error('SNMP trap daily forwarding quota rows are unavailable');

  const orgRemaining = Math.max(0, ORG_DAILY_DELIVERY_LIMIT - Number(organization.delivery_count || 0));
  const globalRemaining = Math.max(0, GLOBAL_DAILY_DELIVERY_LIMIT - Number(global.delivery_count || 0));
  const allowed = Math.min(requested, orgRemaining, globalRemaining);
  const skipped = requested - allowed;
  await exec(
    `UPDATE snmp_trap_ingest_daily_usage
        SET delivery_count = delivery_count + ?,
            forwarding_skipped_count = forwarding_skipped_count + ?
      WHERE usage_date = UTC_DATE()
        AND ((scope_type = 'global' AND scope_id = 0)
          OR (scope_type = 'organization' AND scope_id = ?))`,
    [allowed, skipped, orgId],
  );
  return {
    allowed_count: allowed,
    skipped_count: skipped,
    reason: skipped ? 'daily_forwarding_delivery_limit' : null,
  };
}

/**
 * Return delivery capacity that was reserved but produced no durable outbox
 * row (for example an idempotent duplicate or one isolated INSERT failure).
 * The caller invokes this before committing the same transaction that holds
 * both usage rows, so the quota never charges work that cannot be delivered.
 */
async function refundTrapForwardingUsage(exec, organizationId, deliveryCount) {
  const orgId = Number(organizationId);
  const count = Math.max(0, Math.min(100, Number(deliveryCount) || 0));
  if (!Number.isSafeInteger(orgId) || orgId < 1) {
    throw new TypeError('organizationId must be a positive integer');
  }
  if (!count) return { refunded_count: 0 };
  await exec(
    `UPDATE snmp_trap_ingest_daily_usage
        SET delivery_count = GREATEST(0, delivery_count - ?)
      WHERE usage_date = UTC_DATE()
        AND ((scope_type = 'global' AND scope_id = 0)
          OR (scope_type = 'organization' AND scope_id = ?))`,
    [count, orgId],
  );
  return { refunded_count: count };
}

function usageDto(row, limits) {
  return {
    usage_date: row?.usage_date || null,
    trap_count: Number(row?.trap_count || 0),
    trap_limit: limits.traps,
    varbind_bytes: Number(row?.varbind_bytes || 0),
    varbind_byte_limit: limits.varbinds,
    delivery_count: Number(row?.delivery_count || 0),
    delivery_limit: limits.deliveries,
    metadata_only_count: Number(row?.metadata_only_count || 0),
    dropped_trap_count: Number(row?.dropped_trap_count || 0),
    forwarding_skipped_count: Number(row?.forwarding_skipped_count || 0),
  };
}

async function getDailyIngestUsage(organizationId) {
  const orgId = Number(organizationId);
  const run = async () => {
    const [rows] = await db.query(
      `SELECT usage_date, scope_type, scope_id, trap_count, varbind_bytes,
              delivery_count, metadata_only_count, dropped_trap_count,
              forwarding_skipped_count
         FROM snmp_trap_ingest_daily_usage
        WHERE usage_date = UTC_DATE()
          AND ((scope_type = 'global' AND scope_id = 0)
            OR (scope_type = 'organization' AND scope_id = ?))`,
      [Number.isSafeInteger(orgId) && orgId > 0 ? orgId : -1],
    );
    return {
      organization: usageDto(
        rows.find(row => row.scope_type === 'organization' && Number(row.scope_id) === orgId),
        {
          traps: ORG_DAILY_TRAP_ROW_LIMIT,
          varbinds: ORG_DAILY_VARBIND_BYTE_LIMIT,
          deliveries: ORG_DAILY_DELIVERY_LIMIT,
        },
      ),
      global: usageDto(
        rows.find(row => row.scope_type === 'global' && Number(row.scope_id) === 0),
        {
          traps: GLOBAL_DAILY_TRAP_ROW_LIMIT,
          varbinds: GLOBAL_DAILY_VARBIND_BYTE_LIMIT,
          deliveries: GLOBAL_DAILY_DELIVERY_LIMIT,
        },
      ),
    };
  };
  return typeof db.withPrimaryContext === 'function' ? db.withPrimaryContext(run) : run();
}

/**
 * Extract trap metadata from a net-snmp notification object.
 * Handles both SNMPv1 Trap PDUs and SNMPv2c/v3 TrapV2 PDUs.
 *
 * Returns: { trapOid, trapType, varbinds, snmpVersion }
 */
function extractTrapInfo(notification) {
  const pdu = notification.pdu;

  let trapOid     = null;
  let trapType    = 'unknown';
  let varbinds    = [];
  let snmpVersion = 2;

  if (!pdu) return { trapOid, trapType, varbinds, snmpVersion };

  const rawVarbinds = Array.isArray(pdu.varbinds) ? pdu.varbinds : [];

  // SNMPv1 Trap PDU has a `generic` (or `genericTrap`) integer field
  if (pdu.generic !== undefined || pdu.genericTrap !== undefined) {
    snmpVersion = 1;
    const genericTrap = pdu.generic !== undefined ? pdu.generic : pdu.genericTrap;

    if (genericTrap === 6) {
      // Enterprise-specific trap
      trapType = 'enterpriseSpecific';
      const enterprise  = pdu.enterprise   || '';
      const specificNum = pdu.specific     !== undefined ? pdu.specific
        : (pdu.specificTrap !== undefined ? pdu.specificTrap : 0);
      trapOid = enterprise ? `${enterprise}.0.${specificNum}` : null;
    } else if (genericTrap >= 0 && genericTrap < V1_GENERIC_TRAP_MAP.length) {
      trapType = V1_GENERIC_TRAP_MAP[genericTrap];
      trapOid  = `1.3.6.1.6.3.1.1.5.${genericTrap + 1}`;
    }
  } else {
    // SNMPv2c / v3 TrapV2 PDU — snmpTrapOID is varbind[1]
    snmpVersion = 2;
    const oidVb = rawVarbinds.find(vb => vb.oid === SNMP_TRAP_OID_VARBIND);
    if (oidVb) {
      trapOid  = truncateUtf8(
        typeof oidVb.value === 'string' ? oidVb.value : String(oidVb.value),
        255,
      ).value;
      trapType = SNMP_TRAP_OID_MAP[trapOid] || 'enterpriseSpecific';
    }
  }

  const bounded = boundedVarbindPayload(rawVarbinds);
  varbinds = bounded.varbinds;

  return {
    trapOid,
    trapType,
    varbinds,
    snmpVersion,
    varbindsTruncated: bounded.truncated,
    varbindsOriginalCount: bounded.original_count,
    varbindsTruncationReason: bounded.truncation_reason,
  };
}

// ---------------------------------------------------------------------------
// Core trap handler
// ---------------------------------------------------------------------------

/**
 * Process one inbound trap notification.
 * Called by net-snmp's createReceiver callback.
 */
async function handleTrap(error, notification) {
  if (error) {
    logger.error(safeReceiverError(error), 'SNMP trap receiver rejected a datagram');
    return;
  }

  // Acknowledge the notification (required by net-snmp receiver to free memory)
  if (typeof notification.accept === 'function') {
    notification.accept();
  }

  // net-snmp 3.x supplies the UDP peer under rinfo. Keep sender as a narrow
  // compatibility fallback for older adapters/tests, never as the primary
  // production shape.
  const sourceIp = notification.rinfo?.address || notification.sender?.address || 'unknown';

  try {
    const {
      trapOid,
      trapType,
      varbinds,
      snmpVersion,
      varbindsTruncated,
      varbindsOriginalCount,
      varbindsTruncationReason,
    } = extractTrapInfo(notification);

    // Normalize IPv4-mapped socket addresses to the IPv4 listener contract
    // before lookup/storage. Native IPv6 peers are rejected below.
    const normalizedIp = normalizeIpAddress(sourceIp);
    if (net.isIP(normalizedIp) !== 4) {
      receiverStatus.dropped_unattributed_total += 1;
      sampledOverloadWarning(
        receiverStatus.dropped_unattributed_total,
        'SNMP trap arrived from a non-IPv4 peer; datagram discarded',
      );
      return;
    }

    const initialDevice = await lookupDevice(normalizedIp);
    if (!initialDevice) {
      receiverStatus.dropped_unattributed_total += 1;
      sampledOverloadWarning(
        receiverStatus.dropped_unattributed_total,
        'Unattributed SNMP trap discarded without database persistence',
      );
      return;
    }

    const persistAndDispatch = async () => {
      const receivedAt = new Date().toISOString();
      let trapId;
      let device = initialDevice;
      let orgId = device ? device.organization_id : null;
      let prepared = null;

      if (typeof db.getConnection === 'function') {
        const trapForwardingService = require('./trapForwardingService');
        const { lockSharedDeviceByIp } = require('./tenantDeviceResolverService');
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const exec = conn.execute.bind(conn);
          if (device && orgId && typeof lockSharedDeviceByIp === 'function') {
            const locked = await lockSharedDeviceByIp(normalizedIp, exec);
            if (!locked.device || Number(locked.device.id) !== Number(device.id)
                || Number(locked.device.organization_id) !== Number(orgId)) {
              logger.warn(
                { sourceIp: normalizedIp, reason: locked.reason },
                'SNMP trap source changed during attribution; dropping without persistence',
              );
              device = null;
              orgId = null;
            } else {
              device = locked.device;
              orgId = locked.device.organization_id;
            }
          }

          if (!device || !orgId) {
            receiverStatus.dropped_unattributed_total += 1;
            sampledOverloadWarning(
              receiverStatus.dropped_unattributed_total,
              'SNMP trap source ownership changed; datagram discarded without persistence',
            );
            await conn.rollback();
            return;
          }

          const bounded = boundedVarbindPayload(device ? varbinds : []);
          const requestedVarbindBytes = bounded.varbinds.length ? bounded.bytes : 0;
          const reservation = await reserveTrapIngestUsage(exec, orgId, requestedVarbindBytes);
          if (!reservation.accepted) {
            receiverStatus.dropped_daily_quota_total += 1;
            sampledOverloadWarning(
              receiverStatus.dropped_daily_quota_total,
              'SNMP trap daily row quota reached; datagram not persisted',
            );
            await conn.commit();
            return;
          }
          if (!reservation.store_varbinds && requestedVarbindBytes > 0) {
            receiverStatus.metadata_only_daily_quota_total += 1;
            sampledOverloadWarning(
              receiverStatus.metadata_only_daily_quota_total,
              'SNMP trap daily varbind-byte quota reached; storing metadata only',
            );
          }

          trapId = await storeTrap({
            organizationId: orgId,
            deviceId: device ? device.id : null,
            sourceIp: normalizedIp,
            trapType,
            trapOid,
            varbinds: reservation.store_varbinds ? varbinds : [],
            varbindsTruncated: varbindsTruncated
              || (!reservation.store_varbinds && bounded.original_count > 0),
            varbindsOriginalCount,
            varbindsTruncationReason: reservation.store_varbinds
              ? varbindsTruncationReason
              : (varbindsOriginalCount > 0 ? 'daily_byte_quota' : null),
            snmpVersion,
          }, exec);
          if (device && orgId) {
            prepared = await trapForwardingService.prepareTrapDeliveries({
              trapId,
              organizationId: orgId,
              sourceIp: normalizedIp,
              trapType,
              trapOid,
              snmpVersion,
              receivedAt,
            }, device, {
              exec,
              atomic: true,
              reserveCapacity: count => reserveTrapForwardingUsage(exec, orgId, count),
              refundCapacity: count => refundTrapForwardingUsage(exec, orgId, count),
            });
            if (prepared.skipped_deliveries) {
              receiverStatus.forwarding_skipped_daily_quota_total += prepared.skipped_deliveries;
              sampledOverloadWarning(
                receiverStatus.forwarding_skipped_daily_quota_total,
                'SNMP trap forwarding daily delivery quota reached; matched deliveries skipped',
              );
            }
          }
          await conn.commit();
        } catch (transactionErr) {
          await conn.rollback().catch(() => {});
          throw transactionErr;
        } finally {
          try { conn.release(); } catch { /* pool already discarded it */ }
        }

        // Queue strictly after commit. If Redis is unavailable, durable pending
        // rows remain and the scheduled retry sweep recovers them. Deliberately
        // do not keep an ingress in-flight slot while the bounded queue producer
        // waits on Redis: database commit is the durability boundary, and a
        // blackholed producer must not reduce UDP ingest capacity.
        if (prepared) {
          void trapForwardingService.enqueuePreparedDeliveries(
            prepared.delivery_ids,
            orgId,
          ).catch(queueErr => {
            logger.warn(
              { ...safeReceiverError(queueErr), trapId, organizationId: orgId },
              'Trap forwarding outbox remains pending after queue failure',
            );
          });
        }
      } else {
        trapId = await storeTrap({
          organizationId: orgId,
          deviceId: device ? device.id : null,
          sourceIp: normalizedIp,
          trapType,
          trapOid,
          varbinds: device ? varbinds : [],
          varbindsTruncated,
          varbindsOriginalCount,
          varbindsTruncationReason,
          snmpVersion,
        });

        // Query-only adapters (including legacy embedded tests) lack tenant
        // transaction primitives. Production always takes the atomic branch.
        if (device && orgId) {
          try {
            const trapForwardingService = require('./trapForwardingService');
            await trapForwardingService.forwardTrap({
              trapId,
              organizationId: orgId,
              sourceIp: normalizedIp,
              trapType,
              trapOid,
              snmpVersion,
              receivedAt,
            }, device);
          } catch (forwardErr) {
            logger.error(
              { ...safeReceiverError(forwardErr), trapId, organizationId: orgId },
              'Trap stored but forwarding jobs could not be prepared',
            );
          }
        }
      }

      logger.info(
        { trapId, trapType, trapOid, sourceIp: normalizedIp, deviceId: device ? device.id : null },
        'SNMP trap received',
      );

      if (device && orgId) {
        // Emit inside the resolved tenant context so every async notification
        // hook inherits the same isolated/shared database routing decision.
        eventBus.emit('device.trap', {
          organizationId: orgId,
          device,
          trapId,
          trapType,
          trapOid,
        });
      }
    };

    // Trap source attribution is deliberately primary-only until a canonical
    // cross-database source binding registry exists.
    if (typeof db.withPrimaryContext === 'function') {
      await db.withPrimaryContext(persistAndDispatch);
    } else {
      await persistAndDispatch();
    }
  } catch (err) {
    logger.error({ ...safeReceiverError(err), sourceIp }, 'Failed to process SNMP trap');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function refillRateBudget(now = Date.now()) {
  const elapsedSeconds = Math.max(0, now - rateRefilledAt) / 1000;
  if (elapsedSeconds > 0) {
    rateTokens = Math.min(RATE_BURST, rateTokens + elapsedSeconds * RATE_PER_SECOND);
    rateRefilledAt = now;
  }
  const minuteElapsed = Math.max(0, now - minuteRateRefilledAt) / 60000;
  if (minuteElapsed > 0) {
    minuteRateTokens = Math.min(
      RATE_MINUTE_BURST,
      minuteRateTokens + minuteElapsed * RATE_PER_MINUTE,
    );
    minuteRateRefilledAt = now;
  }
}

function consumeRateToken() {
  refillRateBudget();
  if (rateTokens < 1 || minuteRateTokens < 1) return false;
  rateTokens -= 1;
  minuteRateTokens -= 1;
  return true;
}

function consumeSourceRateToken(organizationId, sourceIp, now = Date.now()) {
  const key = `${organizationId}:${sourceIp}`;
  let bucket = sourceRateBuckets.find(entry => entry.key === key);
  if (!bucket) {
    bucket = sourceRateBuckets.find(entry => entry.key === null)
      || sourceRateBuckets.reduce(
        (oldest, entry) => (entry.lastUsed < oldest.lastUsed ? entry : oldest),
        sourceRateBuckets[0],
      );
    bucket.key = key;
    bucket.tokens = SOURCE_RATE_BURST;
    bucket.refilledAt = now;
  }
  bucket.lastUsed = ++sourceRateSequence;
  const elapsedMinutes = Math.max(0, now - bucket.refilledAt) / 60000;
  if (elapsedMinutes > 0) {
    bucket.tokens = Math.min(
      SOURCE_RATE_BURST,
      bucket.tokens + elapsedMinutes * SOURCE_RATE_PER_MINUTE,
    );
    bucket.refilledAt = now;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function sampledOverloadWarning(counter, message) {
  if (counter === 1 || counter % 100 === 0) logger.warn({ dropped: counter }, message);
}

function discardNotification(notification) {
  try {
    if (typeof notification?.accept === 'function') notification.accept();
  } catch (_) { /* the datagram is deliberately discarded */ }
}

/** Fixed-memory ingress boundary used only by the UDP callback. */
function acceptInboundTrap(error, notification) {
  if (!accepting) {
    discardNotification(notification);
    return false;
  }
  const ingressSource = normalizeIpAddress(
    notification?.rinfo?.address || notification?.sender?.address || 'unknown',
  );
  // Check the fixed hash bucket before spending the broader install-wide
  // budget, so one noisy/unknown source cannot consume every legitimate
  // device's sustained allowance. The fixed array cannot grow under spoofing.
  if (!consumeSourceRateToken(0, ingressSource)) {
    receiverStatus.dropped_source_rate_total += 1;
    sampledOverloadWarning(
      receiverStatus.dropped_source_rate_total,
      'SNMP trap per-source ingress rate limit reached; datagram dropped',
    );
    discardNotification(notification);
    return false;
  }
  if (!consumeRateToken()) {
    receiverStatus.dropped_rate_total += 1;
    sampledOverloadWarning(receiverStatus.dropped_rate_total, 'SNMP trap ingress rate limit reached; datagram dropped');
    discardNotification(notification);
    return false;
  }
  if (inFlight.size >= MAX_IN_FLIGHT) {
    receiverStatus.dropped_overload_total += 1;
    sampledOverloadWarning(receiverStatus.dropped_overload_total, 'SNMP trap receiver is at its fixed in-flight limit; datagram dropped');
    discardNotification(notification);
    return false;
  }

  receiverStatus.accepted_total += 1;
  const task = Promise.resolve(handleTrap(error, notification))
    .catch(err => {
      receiverStatus.processing_errors_total += 1;
      logger.error(safeReceiverError(err), 'Unhandled SNMP trap processing failure');
    })
    .finally(() => inFlight.delete(task));
  inFlight.add(task);
  return true;
}

function receiverSockets(instance) {
  return Object.values(instance?.listener?.sockets || {}).filter(Boolean);
}

async function waitForListenerBind(instance, timeoutMs = 5000) {
  const sockets = receiverSockets(instance);
  // Test doubles and older net-snmp adapters do not expose their dgram sockets.
  // createReceiver returning successfully is the strongest available signal.
  if (!sockets.length) return;

  await Promise.all(sockets.map(socket => new Promise((resolve, reject) => {
    try {
      socket.address();
      resolve();
      return;
    } catch (_) { /* not bound yet */ }

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.removeListener('listening', onListening);
      socket.removeListener('error', onError);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    socket.once('listening', onListening);
    socket.once('error', onError);
    const timer = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error('SNMP trap listener bind timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  })));
}

function attachRuntimeSocketErrors(instance) {
  for (const socket of receiverSockets(instance)) {
    socket.on('error', err => {
      if (receiver !== instance) return;
      accepting = false;
      receiverStatus.state = 'failed';
      receiverStatus.listening = false;
      receiverStatus.ready = false;
      receiverStatus.reason = 'bind_failed';
      receiverStatus.attribution_ready = false;
      receiverStatus.attribution_reason = 'listener_not_ready';
      logger.error(
        { ...safeReceiverError(err), port: receiverStatus.port, bindIp: receiverStatus.bind_ip },
        'SNMP trap listener socket failed',
      );
    });
  }
}

async function startInternal(generation) {
  receiverStatus.enabled = Boolean(config.features.snmp);
  if (!receiverStatus.enabled) {
    accepting = false;
    receiverStatus.configured = false;
    receiverStatus.state = 'disabled';
    receiverStatus.listening = false;
    receiverStatus.ready = false;
    receiverStatus.reason = 'feature_disabled';
    receiverStatus.attribution_ready = false;
    receiverStatus.attribution_reason = 'feature_disabled';
    return getStatus();
  }
  const port = configuredTrapPort();
  const bindIp = configuredTrapBindIp();
  receiverStatus.port = port;
  receiverStatus.bind_ip = bindIp;
  receiverStatus.configured = port !== null && bindIp !== null;
  receiverStatus.state = 'starting';
  receiverStatus.listening = false;
  receiverStatus.ready = false;
  receiverStatus.reason = null;
  receiverStatus.attribution_ready = false;
  receiverStatus.attribution_reason = 'listener_not_ready';

  if (port === null) {
    receiverStatus.state = 'failed';
    receiverStatus.reason = 'invalid_port';
    logger.error({ configuredPort: process.env.SNMP_TRAP_PORT }, 'SNMP trap listener port is invalid');
    return getStatus();
  }
  if (bindIp === null) {
    receiverStatus.state = 'failed';
    receiverStatus.reason = 'invalid_bind_ip';
    logger.error(
      { configuredBindIp: process.env.SNMP_TRAP_BIND_IP },
      'SNMP trap listener bind address must be a valid IPv4 address',
    );
    return getStatus();
  }

  // Production database adapters expose primary context. Lightweight unit
  // adapters do not, and retain their historical createReceiver-only behavior.
  if (typeof db.withPrimaryContext === 'function') {
    const primary = await checkPrimarySchemaReadiness();
    if (generation !== lifecycleGeneration) return getStatus();
    if (!primary.ready) {
      receiverStatus.state = 'failed';
      receiverStatus.reason = 'primary_schema_unavailable';
      logger.error('SNMP trap listener not started because migration 459 is unavailable');
      return getStatus();
    }
  }

  try {
    const instance = snmp.createReceiver(
      { port, address: bindIp, transport: 'udp4', disableAuthorization: true },
      acceptInboundTrap,
    );
    bindingReceiver = instance;
    await waitForListenerBind(instance);
    if (generation !== lifecycleGeneration) {
      try { instance.close(); } catch (_) { /* stop won the lifecycle race */ }
      return getStatus();
    }
    receiver = instance;
    bindingReceiver = null;
    attachRuntimeSocketErrors(instance);
    const feature = typeof db.withPrimaryContext === 'function'
      ? await checkSchemaReadiness({ force: true })
      : { ready: true, reason: null };
    if (generation !== lifecycleGeneration) {
      try { instance.close(); } catch (_) { /* stop won the lifecycle race */ }
      if (receiver === instance) receiver = null;
      return getStatus();
    }
    accepting = true;
    receiverStatus.state = 'listening';
    receiverStatus.listening = true;
    receiverStatus.ready = true;
    receiverStatus.reason = null;
    receiverStatus.attribution_ready = feature.ready;
    receiverStatus.attribution_reason = feature.reason;
    logger.info({ port, bindIp }, 'SNMP trap receiver started');
  } catch (err) {
    const instance = bindingReceiver;
    bindingReceiver = null;
    accepting = false;
    try { instance?.close(); } catch (_) { /* best effort */ }
    if (generation !== lifecycleGeneration) return getStatus();
    receiverStatus.state = 'failed';
    receiverStatus.listening = false;
    receiverStatus.ready = false;
    receiverStatus.reason = 'bind_failed';
    receiverStatus.attribution_ready = false;
    receiverStatus.attribution_reason = 'listener_not_ready';
    logger.error({ ...safeReceiverError(err), port, bindIp }, 'Failed to start SNMP trap receiver');
  }

  return getStatus();
}

/** Start and verify the UDP listener. Concurrent starts share one bind. */
function start() {
  if (receiver && receiverStatus.listening) return Promise.resolve(getStatus());
  if (startPromise) return startPromise;
  startPromise = (async () => {
    if (stopPromise) await stopPromise;
    const generation = ++lifecycleGeneration;
    return startInternal(generation);
  })().finally(() => {
    startPromise = null;
  });
  return startPromise;
}

async function stopInternal() {
  const generation = ++lifecycleGeneration;
  accepting = false;
  receiverStatus.state = 'stopping';
  receiverStatus.ready = false;
  receiverStatus.reason = 'stopping';
  receiverStatus.attribution_ready = false;
  receiverStatus.attribution_reason = 'listener_not_ready';

  const activeReceiver = receiver;
  receiver = null;
  const pendingReceiver = bindingReceiver;
  bindingReceiver = null;
  if (activeReceiver) {
    try { activeReceiver.close(); } catch (_) { /* best effort */ }
  }
  if (pendingReceiver && pendingReceiver !== activeReceiver) {
    try { pendingReceiver.close(); } catch (_) { /* best effort */ }
  }

  const pendingStart = startPromise;
  if (pendingStart) await pendingStart.catch(() => {});
  if (generation !== lifecycleGeneration) {
    // A newer lifecycle operation owns the public state.
    return { drained: false, timed_out: false, remaining: inFlight.size };
  }

  let timedOut = false;
  if (inFlight.size) {
    let timer;
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise(resolve => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, DRAIN_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  receiverStatus.state = receiverStatus.enabled ? 'stopped' : 'disabled';
  receiverStatus.listening = false;
  receiverStatus.ready = false;
  receiverStatus.reason = receiverStatus.enabled ? 'stopped' : 'feature_disabled';
  logger.info({ timedOut, remaining: inFlight.size }, 'SNMP trap receiver stopped');
  return { drained: !timedOut, timed_out: timedOut, remaining: inFlight.size };
}

/** Stop accepting immediately, close UDP, then drain bounded in-flight work. */
function stop() {
  if (stopPromise) return stopPromise;
  stopPromise = stopInternal().finally(() => {
    stopPromise = null;
  });
  return stopPromise;
}

function getStatus() {
  return { ...receiverStatus, in_flight: inFlight.size };
}

module.exports = {
  start,
  stop,
  getStatus,
  configuredTrapBindIp,
  safeReceiverError,
  acceptInboundTrap,
  handleTrap,
  lookupDevice,
  storeTrap,
  reserveTrapIngestUsage,
  reserveTrapForwardingUsage,
  refundTrapForwardingUsage,
  getDailyIngestUsage,
  boundedVarbindPayload,
  extractTrapInfo,
  serializeVarbind,
  SNMP_TRAP_OID_MAP,
  V1_GENERIC_TRAP_MAP,
  MAX_IN_FLIGHT,
  RATE_PER_SECOND,
  RATE_BURST,
  RATE_PER_MINUTE,
  RATE_MINUTE_BURST,
  MAX_VARBIND_COUNT,
  MAX_VARBIND_VALUE_BYTES,
  MAX_VARBINDS_JSON_BYTES,
  DAILY_TRAP_ROW_LIMIT,
  DAILY_VARBIND_BYTE_LIMIT,
  ORG_DAILY_TRAP_ROW_LIMIT,
  GLOBAL_DAILY_TRAP_ROW_LIMIT,
  ORG_DAILY_VARBIND_BYTE_LIMIT,
  GLOBAL_DAILY_VARBIND_BYTE_LIMIT,
  ORG_DAILY_DELIVERY_LIMIT,
  GLOBAL_DAILY_DELIVERY_LIMIT,
  SOURCE_RATE_PER_MINUTE,
  SOURCE_RATE_BURST,
  SOURCE_RATE_BUCKETS,
};
