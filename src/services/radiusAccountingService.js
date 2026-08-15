// =============================================================================
// FireISP 5.0 — RADIUS Accounting Service
// =============================================================================
// Ingests FreeRADIUS accounting records (Start/Stop/Interim-Update) delivered
// via the FreeRADIUS rest module POST, persists them to connection_logs, and
// provides CDR export and retention purge utilities.
// =============================================================================

const crypto = require('crypto');
const net = require('net');
const db = require('../config/database');
const { ValidationError } = require('../utils/errors');
const { canonicalIpv6, canonicalIpv6Prefix } = require('../utils/ipAddress');
const logger = require('../utils/logger').child({ service: 'radiusAccounting' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combine an octet counter with its Gigawords extension.
 * Gigawords wraps at 2^32 (4,294,967,296). JavaScript Number is safe up to 2^53,
 * so we use plain Number arithmetic for compatibility with mysql2 row values.
 *
 * @param {number|null} octets
 * @param {number|null} gigawords
 * @returns {number}
 */
function combineOctetsGigawords(octets, gigawords) {
  const o = octets || 0;
  const g = gigawords || 0;
  if (!Number.isSafeInteger(o) || o < 0 || !Number.isSafeInteger(g) || g < 0) {
    throw new ValidationError('RADIUS counters must be non-negative safe integers');
  }
  const total = o + g * 4294967296;
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('Combined RADIUS octet counter exceeds the supported safe-integer range');
  }
  return total;
}

/**
 * Derive the IP stack type from which addresses are present in the accounting record.
 * @param {string|null} framedIp
 * @param {string|null} framedIpv6
 * @returns {'ipv4'|'ipv6'|'dual'|null}
 */
function deriveStackType(framedIp, framedIpv6) {
  if (framedIp && framedIpv6) return 'dual';
  if (framedIpv6) return 'ipv6';
  if (framedIp) return 'ipv4';
  return null;
}

/** Normalize an accounting event timestamp to MySQL TIMESTAMP's supported range. */
function normalizeEventTimestamp(value) {
  if (value === undefined || value === null || value === '') return new Date();
  let date;
  if (value instanceof Date) date = new Date(value.getTime());
  else if ((typeof value === 'number' && Number.isSafeInteger(value))
      || (typeof value === 'string' && /^\d+$/.test(value))) {
    const numeric = Number(value);
    date = new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
  } else if (typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    date = new Date(value);
  } else {
    throw new ValidationError('Invalid accounting event timestamp', [{
      field: 'Event-Timestamp', message: 'use Unix seconds or timezone-qualified ISO 8601',
    }]);
  }
  const minimum = Date.UTC(1970, 0, 1);
  const maximum = Date.UTC(2038, 0, 19, 3, 14, 7);
  const futureSkew = Math.min(
    Math.max(Number.parseInt(process.env.RADIUS_ACCOUNTING_MAX_CLOCK_SKEW_SECONDS || '300', 10) || 300, 0),
    3600,
  );
  if (Number.isNaN(date.getTime()) || date.getTime() < minimum || date.getTime() > maximum
      || date.getTime() > Date.now() + futureSkew * 1000) {
    throw new ValidationError('Invalid accounting event timestamp', [{
      field: 'Event-Timestamp',
      message: 'Event-Timestamp is outside the supported 1970-01-01 through 2038-01-19 range',
    }]);
  }
  return date;
}

const TERMINATE_CAUSES = Object.freeze({
  1: 'User-Request',
  2: 'Lost-Carrier',
  3: 'Lost-Service',
  4: 'Idle-Timeout',
  5: 'Session-Timeout',
  6: 'Admin-Reset',
  7: 'Admin-Reboot',
  8: 'Port-Error',
  9: 'NAS-Error',
  10: 'NAS-Request',
  11: 'NAS-Reboot',
  12: 'Port-Unneeded',
  13: 'Port-Preempted',
  14: 'Port-Suspended',
  15: 'Service-Unavailable',
  16: 'Callback',
  17: 'User-Error',
  18: 'Host-Request',
});

function normalizeTerminateCause(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && String(value).trim() === String(numeric)) {
    return TERMINATE_CAUSES[numeric] || `Code-${numeric}`;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 64) {
    throw new ValidationError('Invalid Acct-Terminate-Cause');
  }
  return normalized;
}

const USAGE_FIELDS = Object.freeze(['bytesIn', 'bytesOut', 'packetsIn', 'packetsOut', 'duration']);

function utcDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function utcMonth(value) {
  return new Date(value).toISOString().slice(0, 7);
}

/**
 * Calculate one accepted accounting observation's counter deltas.
 *
 * A decrease is a NAS counter reset, never negative usage. We baseline the new
 * raw value, mark the lifecycle incomplete, and resume operational deltas from
 * that baseline. Deltas whose observation interval crosses UTC midnight are
 * retained as an end-day operational estimate. Calendar-month crossings mark
 * both months incomplete so monetary/FUP/rollover consumers fail closed.
 */
function calculateUsageDelta({
  previous = {}, current = {}, previousEventAt = null, eventAt,
  priorComplete = true, baselineReason = null, initializeBaseline = false,
}) {
  const deltas = {};
  let counterReset = false;
  for (const field of USAGE_FIELDS) {
    const next = current[field];
    const prior = previous[field];
    if (initializeBaseline || next === null || next === undefined) {
      deltas[field] = 0;
      continue;
    }
    if (prior === null || prior === undefined) {
      // A field that appears after the lifecycle baseline is not safely
      // attributable. Baseline it rather than counting its cumulative value.
      // Only octet gaps affect monetary completeness; packet/duration fields
      // are optional in valid RADIUS Start packets.
      deltas[field] = 0;
      if (field === 'bytesIn' || field === 'bytesOut') counterReset = true;
      continue;
    }
    if (Number(next) < Number(prior)) {
      deltas[field] = 0;
      counterReset = true;
    } else {
      deltas[field] = Number(next) - Number(prior);
    }
  }

  const crossesUtcBoundary = Boolean(previousEventAt)
    && utcDate(previousEventAt) !== utcDate(eventAt);
  const crossesUtcMonthBoundary = Boolean(previousEventAt)
    && utcMonth(previousEventAt) !== utcMonth(eventAt);
  const nextSessionComplete = Boolean(priorComplete) && !baselineReason && !counterReset;
  const anomalyReason = baselineReason
    || (counterReset ? 'counter_reset'
      : (crossesUtcMonthBoundary ? 'utc_month_boundary_estimate'
        : (crossesUtcBoundary ? 'utc_daily_allocation_estimate' : null)));
  return {
    deltas,
    nextSessionComplete,
    // End-day allocation is an estimate for daily operational charts. It only
    // disables monetary automation when an interval crosses a calendar-month
    // boundary; routine midnight heartbeats inside a month remain usable.
    rowComplete: nextSessionComplete && !crossesUtcMonthBoundary,
    anomalyReason,
    anomalyCount: anomalyReason ? 1 : 0,
    sessionAnomalyCount: (baselineReason || counterReset) ? 1 : 0,
    crossesUtcMonthBoundary,
    previousEventAt,
  };
}

async function recordUsageDelta(connection, {
  organizationId,
  sessionInstanceId,
  connectionLogId,
  contractId,
  clientId,
  nasId,
  username,
  eventAt,
  usage,
}) {
  if (!sessionInstanceId) return;
  const { deltas, rowComplete, anomalyReason, anomalyCount } = usage;
  if (Object.values(deltas).every(value => value === 0) && !anomalyReason) return;
  const upsert = (usageDate, rowDeltas, complete, reason, anomaly, rowEventAt) => connection.execute(
    `INSERT INTO radius_accounting_usage_daily
       (organization_id, usage_date, session_instance_id, connection_log_id,
        contract_id, client_id, nas_id, username,
        bytes_in_delta, bytes_out_delta, packets_in_delta, packets_out_delta,
        duration_delta, is_complete, anomaly_count, anomaly_reason,
        first_event_at, last_event_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       connection_log_id = VALUES(connection_log_id),
       contract_id = COALESCE(VALUES(contract_id), contract_id),
       client_id = COALESCE(VALUES(client_id), client_id),
       nas_id = COALESCE(VALUES(nas_id), nas_id),
       bytes_in_delta = bytes_in_delta + VALUES(bytes_in_delta),
       bytes_out_delta = bytes_out_delta + VALUES(bytes_out_delta),
       packets_in_delta = packets_in_delta + VALUES(packets_in_delta),
       packets_out_delta = packets_out_delta + VALUES(packets_out_delta),
       duration_delta = duration_delta + VALUES(duration_delta),
       is_complete = is_complete AND VALUES(is_complete),
       anomaly_count = anomaly_count + VALUES(anomaly_count),
       anomaly_reason = COALESCE(VALUES(anomaly_reason), anomaly_reason),
       first_event_at = LEAST(first_event_at, VALUES(first_event_at)),
       last_event_at = GREATEST(last_event_at, VALUES(last_event_at))`,
    [organizationId, usageDate, sessionInstanceId, connectionLogId,
      contractId || null, clientId || null, nasId || null, username,
      rowDeltas.bytesIn, rowDeltas.bytesOut, rowDeltas.packetsIn, rowDeltas.packetsOut,
      rowDeltas.duration, complete ? 1 : 0, anomaly, reason,
      rowEventAt, rowEventAt],
  );
  if (usage.crossesUtcMonthBoundary && usage.previousEventAt) {
    // Flag both sides of a month boundary. Assigning the entire cumulative
    // delta to the receipt day would otherwise make the prior month silently
    // under-count while only the new month failed closed.
    await upsert(
      utcDate(usage.previousEventAt),
      Object.fromEntries(USAGE_FIELDS.map(field => [field, 0])),
      false,
      'utc_month_boundary_estimate',
      1,
      usage.previousEventAt,
    );
  }
  await upsert(utcDate(eventAt), deltas, rowComplete, anomalyReason, anomalyCount, eventAt);
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Ingest a RADIUS accounting record (Start/Stop/Interim-Update).
 *
 * Called by the FreeRADIUS rest module POST handler. Handles:
 *  - RADIUS account lookup (username → contract_id / client_id / nas_id)
 *  - MAC move detection on Start events
 *  - Upsert into connection_logs (partitioned on event_at)
 *
 * @param {object} attrs - Normalised RADIUS accounting attributes
 * @param {string}      attrs.acctStatusType       - 'Start' | 'Stop' | 'Interim-Update'
 * @param {string}      attrs.userName              - RADIUS username
 * @param {string}      attrs.acctSessionId         - Acct-Session-Id (FreeRADIUS)
 * @param {string}      attrs.nasIpAddress          - NAS IP
 * @param {string|null} attrs.nasPortId
 * @param {string|null} attrs.calledStationId
 * @param {string|null} attrs.callingStationId      - MAC address of CPE
 * @param {string|null} attrs.framedIpAddress
 * @param {string|null} attrs.framedIpv6Prefix
 * @param {number|null} attrs.acctInputOctets
 * @param {number|null} attrs.acctOutputOctets
 * @param {number|null} attrs.acctInputGigawords
 * @param {number|null} attrs.acctOutputGigawords
 * @param {number|null} attrs.acctSessionTime       - seconds
 * @param {string|null} attrs.acctTerminateCause
 * @param {number|null} attrs.acctInputOctetsV6
 * @param {number|null} attrs.acctOutputOctetsV6
 * @param {number}      attrs.organizationId        - from the ingest caller
 * @param {number|null} attrs.nasId                  - resolved live NAS id
 * @returns {Promise<{action: 'insert'|'update'|'noop', id: number|null, macMove: boolean}>}
 */
async function ingestAccounting(attrs) {
  const {
    acctStatusType,
    userName,
    acctSessionId,
    nasIpAddress,
    nasPortId = null,
    calledStationId = null,
    callingStationId = null,
    framedIpAddress = null,
    framedIpv6Prefix: rawFramedIpv6Prefix = null,
    acctInputOctets = null,
    acctOutputOctets = null,
    acctInputGigawords = null,
    acctOutputGigawords = null,
    acctSessionTime = null,
    acctTerminateCause = null,
    acctInputOctetsV6 = null,
    acctOutputOctetsV6 = null,
    acctInputPackets = null,
    acctOutputPackets = null,
    eventTimestamp = null,
    acctDelayTime = null,
    organizationId,
    nasId = null,
    provenance = {},
  } = attrs;

  if (!Number.isSafeInteger(Number(organizationId)) || Number(organizationId) <= 0) {
    throw new ValidationError('Accounting ingest requires a tenant-owned NAS');
  }
  const requiredStrings = [
    ['userName', userName, 64], ['acctSessionId', acctSessionId, 64], ['nasIpAddress', nasIpAddress, 45],
  ];
  for (const [field, value, maximum] of requiredStrings) {
    if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
      throw new ValidationError(`Invalid ${field}`);
    }
  }
  if (net.isIP(nasIpAddress) === 0) throw new ValidationError('Invalid NAS-IP-Address');
  let framedIpv6Prefix = null;
  if (rawFramedIpv6Prefix !== null && rawFramedIpv6Prefix !== '') {
    try {
      framedIpv6Prefix = canonicalIpv6Prefix(rawFramedIpv6Prefix);
    } catch (_error) {
      throw new ValidationError('Invalid Framed-IPv6-Prefix', [{
        field: 'Framed-IPv6-Prefix', message: 'expected a valid IPv6 CIDR prefix from /0 through /128',
      }]);
    }
  }
  for (const [field, value, maximum] of [
    ['nasPortId', nasPortId, 100], ['calledStationId', calledStationId, 100],
    ['callingStationId', callingStationId, 100], ['framedIpv6Prefix', framedIpv6Prefix, 64],
  ]) {
    if (value !== null && (typeof value !== 'string' || value.length > maximum)) {
      throw new ValidationError(`Invalid ${field}`);
    }
  }
  if (framedIpAddress && net.isIP(framedIpAddress) !== 4) throw new ValidationError('Invalid Framed-IP-Address');
  for (const [field, value, maximum] of [
    ['acctInputOctets', acctInputOctets], ['acctOutputOctets', acctOutputOctets],
    ['acctInputGigawords', acctInputGigawords], ['acctOutputGigawords', acctOutputGigawords],
    ['acctInputPackets', acctInputPackets], ['acctOutputPackets', acctOutputPackets],
    ['acctSessionTime', acctSessionTime, 0xffffffff], ['acctDelayTime', acctDelayTime, 0xffffffff],
    ['acctInputOctetsV6', acctInputOctetsV6], ['acctOutputOctetsV6', acctOutputOctetsV6],
  ]) {
    if (value !== null && value !== undefined
        && (!Number.isSafeInteger(Number(value)) || Number(value) < 0
          || (maximum !== undefined && Number(value) > maximum))) {
      throw new ValidationError(`Invalid ${field}`);
    }
  }

  logger.debug({ organizationId, acctStatusType }, 'Ingesting RADIUS accounting record');

  // ------------------------------------------------------------------
  // 1. Resolve the live NAS and look up the subscriber inside that same tenant.
  // Starting from nas (rather than radius) preserves the NAS id for unknown
  // usernames while preventing a duplicate username in another tenant from
  // being selected.
  // ------------------------------------------------------------------
  const nasSelector = nasId ? 'n.id = ?' : 'n.ip_address = ?';
  const nasSelectorValue = nasId || nasIpAddress;
  const [radiusRows] = await db.query(
    `SELECT n.id AS resolved_nas_id, n.ip_address AS resolved_nas_ip,
            r.id AS radius_id, r.contract_id, r.client_id
       FROM nas n
       LEFT JOIN radius r
         ON r.username = ?
        AND r.organization_id = n.organization_id
        AND r.deleted_at IS NULL
      WHERE n.organization_id = ?
        AND ${nasSelector}
        AND n.status = 'active'
        AND n.deleted_at IS NULL
      LIMIT 2`,
    [userName, organizationId, nasSelectorValue],
  );
  if (radiusRows.length !== 1) {
    throw new ValidationError('Unable to resolve one live NAS for accounting ingest');
  }

  const resolved = radiusRows[0];
  const normalizeIp = value => (net.isIP(value) === 6 ? canonicalIpv6(value) : value);
  if (nasId && normalizeIp(resolved.resolved_nas_ip) !== normalizeIp(nasIpAddress)) {
    throw new ValidationError('NAS-IP-Address does not match the tenant-owned NAS');
  }
  const acct = resolved.radius_id ? resolved : null;
  // connection_logs requires NOT NULL for contract_id and client_id.
  // Use 0 as a sentinel value when the RADIUS username is unknown — this
  // preserves the accounting record even if the subscriber can't be resolved.
  const contractId = acct ? acct.contract_id : 0;
  const clientId = acct ? acct.client_id : 0;
  const resolvedNasId = resolved.resolved_nas_id;

  // ------------------------------------------------------------------
  // 2. Compute byte totals (handle 32-bit Gigawords wraparound)
  // ------------------------------------------------------------------
  const bytesIn = acctInputOctets === null && acctInputGigawords === null
    ? null
    : combineOctetsGigawords(acctInputOctets, acctInputGigawords);
  const bytesOut = acctOutputOctets === null && acctOutputGigawords === null
    ? null
    : combineOctetsGigawords(acctOutputOctets, acctOutputGigawords);
  const stackType = deriveStackType(framedIpAddress, framedIpv6Prefix);
  const delaySeconds = Number.isInteger(Number(acctDelayTime)) && Number(acctDelayTime) >= 0
    ? Number(acctDelayTime)
    : 0;
  const hasExplicitEventTimestamp = eventTimestamp !== undefined
    && eventTimestamp !== null && eventTimestamp !== '';
  const observedEventAt = !hasExplicitEventTimestamp
    ? new Date(Date.now() - delaySeconds * 1000)
    : normalizeEventTimestamp(eventTimestamp);
  const minimumTimestamp = Date.UTC(1970, 0, 1);
  if (observedEventAt.getTime() < minimumTimestamp
      || (acctSessionTime !== null
        && observedEventAt.getTime() - Number(acctSessionTime) * 1000 < minimumTimestamp)) {
    throw new ValidationError('Acct-Session-Time exceeds the supported event chronology');
  }
  const terminateCause = normalizeTerminateCause(acctTerminateCause);

  // ------------------------------------------------------------------
  // 3. Determine event_type
  // ------------------------------------------------------------------
  const statusTypeMap = {
    'Start': 'start',
    'Stop': 'stop',
    'Interim-Update': 'interim-update',
  };
  const eventType = statusTypeMap[acctStatusType];
  if (!eventType) {
    throw new ValidationError('Invalid Acct-Status-Type', [{
      field: 'Acct-Status-Type',
      message: 'Acct-Status-Type must be Start, Interim-Update, or Stop',
    }]);
  }
  const provenanceValue = (value, maximum) => {
    if (value === undefined || value === null || value === '') return null;
    const string = String(value);
    return string.length <= maximum ? string : string.slice(0, maximum);
  };
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify([
    Number(organizationId), resolvedNasId, userName, acctSessionId, eventType,
    observedEventAt.toISOString(), nasIpAddress, nasPortId, calledStationId,
    callingStationId, framedIpAddress, framedIpv6Prefix, bytesIn, bytesOut,
    acctInputPackets, acctOutputPackets, acctSessionTime, terminateCause,
    delaySeconds, acctInputOctetsV6, acctOutputOctetsV6,
  ])).digest('hex');
  const recordReceipt = (connection, action, _connectionLogId) => connection.execute(
    `INSERT INTO collector_ingest_receipts
       (organization_id, source, api_token_id, nas_id, event_type, action, bucket_at,
        records_received, records_inserted, records_replayed,
        request_id, source_ip, user_agent, payload_chain_hash,
        first_received_at, last_received_at)
     VALUES (?, ?, ?, ?, ?, ?,
             FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(NOW(3)) / 60) * 60),
             1, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       records_received = records_received + 1,
       records_inserted = records_inserted + VALUES(records_inserted),
       records_replayed = records_replayed + VALUES(records_replayed),
       last_received_at = VALUES(last_received_at),
       payload_chain_hash = SHA2(CONCAT(payload_chain_hash, ':', VALUES(payload_chain_hash)), 256)`,
    [organizationId,
      provenanceValue(provenance.source || 'radius_internal', 32),
      Number.isSafeInteger(Number(provenance.apiTokenId)) ? Number(provenance.apiTokenId) : 0,
      resolvedNasId || 0, eventType, action,
      action === 'insert' ? 1 : 0, action === 'noop' ? 1 : 0,
      provenanceValue(provenance.requestId, 64),
      provenanceValue(provenance.sourceIp, 45),
      provenanceValue(provenance.userAgent, 255),
      payloadHash],
  );

  // ------------------------------------------------------------------
  // 4a. Start: check for MAC move, then insert
  // ------------------------------------------------------------------
  let macMove = false;

  if (eventType === 'start') {
    const connection = await db.getConnection();
    const lockName = crypto.createHash('sha256')
      .update(`${organizationId}|${userName}|accounting-lifecycle`)
      .digest('hex');
    let transactionStarted = false;
    let lockAcquired = false;
    try {
      const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
      lockAcquired = Number(lockRows[0]?.acquired) === 1;
      if (!lockAcquired) throw new Error('Timed out serializing Accounting-Start');
      await connection.beginTransaction();
      transactionStarted = true;
      // Acct-Start is frequently retransmitted when an Accounting-Response is
      // delayed or lost.  Treat the NAS/session identity as idempotent so a replay
      // cannot create a duplicate active session or a second evidence event.
      let [duplicateRows] = await connection.execute(
        `SELECT id, session_instance_id, event_type, event_at, last_accounting_at,
                framed_ip, framed_ipv6_prefix, calling_station_id
           FROM connection_logs
        WHERE organization_id = ? AND nas_id = ? AND username = ?
          AND acct_session_id = ?
        ORDER BY COALESCE(last_accounting_at, event_at) DESC, id DESC LIMIT 1
        FOR UPDATE`,
        [organizationId, resolvedNasId, userName, acctSessionId],
      );
      if (duplicateRows.length === 0) {
        [duplicateRows] = await connection.execute(
          `SELECT id, session_instance_id, event_type, event_at, last_accounting_at,
                  framed_ip, framed_ipv6_prefix, calling_station_id
             FROM connection_logs
            WHERE organization_id = ? AND nas_id = ? AND username = ?
              AND acct_session_id IS NULL AND session_id = ?
            ORDER BY event_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [organizationId, resolvedNasId, userName, acctSessionId],
        );
      }
      const duplicate = duplicateRows[0];
      const duplicateLastAt = duplicate
        ? new Date(duplicate.last_accounting_at || duplicate.event_at).getTime()
        : 0;
      const livenessMinutes = Math.min(
        Math.max(Number.parseInt(process.env.RADIUS_SESSION_LIVENESS_MINUTES || '60', 10) || 60, 1),
        1440,
      );
      const staleOpenSession = duplicate && duplicate.event_type !== 'stop'
        && observedEventAt.getTime() > duplicateLastAt + livenessMinutes * 60 * 1000;
      const ipv4Changed = duplicate && duplicate.event_type !== 'stop'
        && duplicate.framed_ip && framedIpAddress
        && duplicate.framed_ip !== framedIpAddress;
      const ipv6Changed = duplicate && duplicate.event_type !== 'stop'
        && duplicate.framed_ipv6_prefix && framedIpv6Prefix
        && duplicate.framed_ipv6_prefix !== framedIpv6Prefix;
      const stationChanged = duplicate && duplicate.event_type !== 'stop'
        && duplicate.calling_station_id && callingStationId
        && duplicate.calling_station_id !== callingStationId;
      const identityChanged = Boolean(ipv4Changed || ipv6Changed || stationChanged);
      const identityEnriched = Boolean(duplicate && duplicate.event_type !== 'stop' && (
        (!duplicate.framed_ip && framedIpAddress)
        || (!duplicate.framed_ipv6_prefix && framedIpv6Prefix)
        || (!duplicate.calling_station_id && callingStationId)
      ));
      const duplicateStartAt = duplicate ? new Date(duplicate.event_at).getTime() : 0;
      const distinctLaterStart = duplicate && duplicate.event_type !== 'stop'
        && hasExplicitEventTimestamp && observedEventAt.getTime() > duplicateStartAt
        && observedEventAt.getTime() >= duplicateLastAt;
      if (identityChanged && hasExplicitEventTimestamp
          && observedEventAt.getTime() < duplicateLastAt) {
        throw new ValidationError('Conflicting Accounting-Start predates the current session evidence; the lifecycle was not mutated');
      }
      const newOpenLifecycle = identityChanged || distinctLaterStart;
      const isReplay = duplicate && (
        (duplicate.event_type !== 'stop' && !staleOpenSession && !newOpenLifecycle)
        // A Start observed after a Stop is a new lifecycle even when the NAS
        // reuses Acct-Session-Id immediately. Only an older/equal Start is a
        // replay of the closed lifecycle.
        || (duplicate.event_type === 'stop' && observedEventAt.getTime() <= duplicateLastAt)
      );
      if (isReplay) {
        if (identityEnriched) {
          if (observedEventAt.getTime() < duplicateLastAt) {
            throw new ValidationError('Accounting-Start enrichment predates the current session evidence; the lifecycle was not mutated');
          }
          const [enrichmentResult] = await connection.execute(
            `UPDATE connection_logs
                SET framed_ip = COALESCE(framed_ip, ?),
                    framed_ipv6_prefix = COALESCE(framed_ipv6_prefix, ?),
                    calling_station_id = COALESCE(calling_station_id, ?),
                    last_accounting_at = ?, last_accounting_received_at = NOW(3)
              WHERE id = ? AND organization_id = ? AND event_type != 'stop'`,
            [framedIpAddress, framedIpv6Prefix, callingStationId,
              observedEventAt, duplicate.id, organizationId],
          );
          if (Number(enrichmentResult.affectedRows) !== 1) {
            throw new Error('Accounting-Start enrichment lost its locked session');
          }
          await recordReceipt(connection, 'update', duplicate.id);
          await connection.commit();
          transactionStarted = false;
          logger.debug({ organizationId }, 'Accounting-Start enriched the active session identity');
          return { action: 'update', id: duplicate.id, macMove: false,
            sessionInstanceId: duplicate.session_instance_id || null };
        }
        await recordReceipt(connection, 'noop', duplicate.id);
        await connection.commit();
        transactionStarted = false;
        logger.debug({ organizationId }, 'Duplicate Accounting-Start ignored');
        return { action: 'noop', id: duplicate.id, macMove: false,
          sessionInstanceId: duplicate.session_instance_id || null };
      }
      if (staleOpenSession || newOpenLifecycle) {
        await connection.execute(
          `UPDATE connection_logs
              SET event_type = 'stop', terminate_cause = ?,
                  last_accounting_at = ?, last_accounting_received_at = NOW(3)
            WHERE id = ? AND organization_id = ? AND event_type != 'stop'`,
          [identityChanged ? 'Session-Identity-Changed' : 'Session-Restarted',
            observedEventAt, duplicate.id, organizationId],
        );
        if (stationChanged) macMove = true;
      }

      // Detect an open session for the same username with a different session-id
      // (which implies the subscriber reconnected from a potentially different device/NAS).
      const [openRows] = await connection.execute(
        `SELECT id, calling_station_id, nas_id, acct_session_id, event_at
       FROM connection_logs
       WHERE username = ?
         AND organization_id = ?
         AND event_type IN ('start', 'interim-update')
         AND (acct_session_id IS NULL OR acct_session_id != ?)
       ORDER BY event_at DESC
       LIMIT 1`,
        [userName, organizationId, acctSessionId],
      );

      if (openRows.length > 0) {
        const open = openRows[0];
        const macChanged = callingStationId !== null &&
        open.calling_station_id !== null &&
        open.calling_station_id !== callingStationId;
        const nasChanged = resolvedNasId !== null &&
        open.nas_id !== null &&
        open.nas_id !== resolvedNasId;

        if (macChanged || nasChanged) {
          macMove = true;
          logger.info({ organizationId }, 'MAC move detected — synthesising stop for stale session');

          // Close the current-session projection in place.  The evidence trigger
          // appends the synthetic Stop while preserving event_at as session start.
          await connection.execute(
            `UPDATE connection_logs
              SET event_type = 'stop', terminate_cause = 'Session-Moved',
                  last_accounting_at = ?, last_accounting_received_at = NOW(3)
            WHERE id = ? AND organization_id = ?`,
            [observedEventAt, open.id, organizationId],
          );

          // Record the MAC move event (mac_move_events has old_mac/new_mac columns)
          await connection.execute(
            `INSERT INTO mac_move_events
             (organization_id, username, old_mac, new_mac, old_nas_id, new_nas_id, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
              organizationId,
              userName,
              open.calling_station_id,
              callingStationId,
              open.nas_id,
              resolvedNasId,
            ],
          );
        }
      }

      // Insert the new Start row and its first monotonic usage delta in the
      // same transaction. A rollback cannot leave billing usage without the
      // corresponding session projection (or vice versa).
      const sessionInstanceId = crypto.randomUUID();
      const startCounters = {
        bytesIn, bytesOut, packetsIn: acctInputPackets,
        packetsOut: acctOutputPackets, duration: acctSessionTime,
      };
      const startHasCumulativeUsage = USAGE_FIELDS.some(field => Number(startCounters[field] || 0) > 0);
      const startUsage = calculateUsageDelta({
        current: startCounters,
        eventAt: observedEventAt,
        priorComplete: !startHasCumulativeUsage,
        baselineReason: startHasCumulativeUsage ? 'nonzero_start_baseline' : null,
        initializeBaseline: true,
      });
      const [insertResult] = await connection.execute(
        `INSERT INTO connection_logs
         (username, contract_id, client_id, nas_id, nas_ip_address,
          acct_session_id, session_id,
          session_instance_id,
          nas_port_id, called_station_id, calling_station_id,
          framed_ip, framed_ipv6_prefix,
          event_type, event_at,
          bytes_in, bytes_out, packets_in, packets_out, session_duration, terminate_cause,
          acct_input_octets_v6, acct_output_octets_v6, stack_type,
          organization_id, last_accounting_at, last_accounting_received_at, acct_delay_seconds,
          attribution_evidence_complete, attribution_anomaly_reason,
          usage_accounting_complete, usage_anomaly_count,
          usage_last_bytes_in, usage_last_bytes_out,
          usage_last_packets_in, usage_last_packets_out, usage_last_duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'start', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userName,
          contractId,
          clientId,
          resolvedNasId,
          nasIpAddress,
          acctSessionId,
          acctSessionId,  // session_id mirrors acct_session_id for backward compat
          sessionInstanceId,
          nasPortId,
          calledStationId,
          callingStationId,
          framedIpAddress,
          framedIpv6Prefix,
          observedEventAt,
          bytesIn,
          bytesOut,
          acctInputPackets,
          acctOutputPackets,
          acctSessionTime,
          terminateCause,
          acctInputOctetsV6,
          acctOutputOctetsV6,
          stackType,
          organizationId,
          observedEventAt,
          delaySeconds,
          1,
          null,
          startUsage.nextSessionComplete ? 1 : 0,
          startUsage.anomalyCount,
          bytesIn,
          bytesOut,
          acctInputPackets,
          acctOutputPackets,
          acctSessionTime,
        ],
      );
      await recordUsageDelta(connection, {
        organizationId,
        sessionInstanceId,
        connectionLogId: insertResult.insertId,
        contractId,
        clientId,
        nasId: resolvedNasId,
        username: userName,
        eventAt: observedEventAt,
        usage: startUsage,
      });
      await recordReceipt(connection, 'insert', insertResult.insertId);

      await connection.commit();
      transactionStarted = false;
      logger.debug({ id: insertResult.insertId, organizationId }, 'Start row inserted into connection_logs');
      return { action: 'insert', id: insertResult.insertId, macMove, sessionInstanceId };
    } catch (err) {
      if (transactionStarted) await connection.rollback();
      throw err;
    } finally {
      let released = !lockAcquired;
      if (lockAcquired) {
        try {
          const [releaseRows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
          released = Number(releaseRows[0]?.released) === 1;
        } catch (_err) { released = false; }
      }
      if (released) connection.release();
      else connection.destroy();
    }
  }

  // ------------------------------------------------------------------
  // 4b. Interim-Update / Stop: update the open row, or insert if missing
  // ------------------------------------------------------------------
  // Application rows use the indexed acct_session_id lookup; a separate
  // legacy-only fallback preserves deprecated session_id rows without putting
  // COALESCE on the hot-path index.
  const lifecycleConnection = await db.getConnection();
  const lifecycleLockName = crypto.createHash('sha256')
    // All event types use the same per-subscriber lock domain. This serializes
    // Start against Interim/Stop and also makes the cross-session MAC-move
    // decision atomic. Different subscribers still ingest concurrently.
    .update(`${organizationId}|${userName}|accounting-lifecycle`)
    .digest('hex');
  let lifecycleTransaction = false;
  let lifecycleLock = false;
  try {
    const [lockRows] = await lifecycleConnection.execute(
      'SELECT GET_LOCK(?, 5) AS acquired',
      [lifecycleLockName],
    );
    lifecycleLock = Number(lockRows[0]?.acquired) === 1;
    if (!lifecycleLock) throw new Error('Timed out serializing accounting update');
    await lifecycleConnection.beginTransaction();
    lifecycleTransaction = true;
    let [currentRows] = await lifecycleConnection.execute(
      `SELECT id, session_instance_id, event_type, last_accounting_at, event_at,
            contract_id, client_id, nas_id, username,
            bytes_in, bytes_out, packets_in, packets_out, session_duration,
            usage_accounting_complete, usage_anomaly_count,
            attribution_evidence_complete, attribution_anomaly_reason,
            usage_last_bytes_in, usage_last_bytes_out,
            usage_last_packets_in, usage_last_packets_out, usage_last_duration,
            terminate_cause, framed_ip, framed_ipv6_prefix
      FROM connection_logs
      WHERE organization_id = ? AND nas_id <=> ? AND username = ?
        AND acct_session_id = ?
      ORDER BY COALESCE(last_accounting_at, event_at) DESC, id DESC LIMIT 1
      FOR UPDATE`,
      [organizationId, resolvedNasId, userName, acctSessionId],
    );
    if (currentRows.length === 0) {
      [currentRows] = await lifecycleConnection.execute(
        `SELECT id, session_instance_id, event_type, last_accounting_at, event_at,
                contract_id, client_id, nas_id, username,
                bytes_in, bytes_out, packets_in, packets_out, session_duration,
                usage_accounting_complete, usage_anomaly_count,
                attribution_evidence_complete, attribution_anomaly_reason,
                usage_last_bytes_in, usage_last_bytes_out,
                usage_last_packets_in, usage_last_packets_out, usage_last_duration,
                terminate_cause, framed_ip, framed_ipv6_prefix
           FROM connection_logs
          WHERE organization_id = ? AND nas_id <=> ? AND username = ?
            AND acct_session_id IS NULL AND session_id = ?
          ORDER BY event_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [organizationId, resolvedNasId, userName, acctSessionId],
      );
    }
    let current = currentRows[0] || null;
    const currentInstanceId = current?.session_instance_id || (current ? crypto.randomUUID() : null);
    const currentObservedAt = current
      ? new Date(current.last_accounting_at || current.event_at).getTime()
      : null;
    let currentRawUsage = current ? {
      bytesIn: current.usage_last_bytes_in,
      bytesOut: current.usage_last_bytes_out,
      packetsIn: current.usage_last_packets_in,
      packetsOut: current.usage_last_packets_out,
      duration: current.usage_last_duration,
    } : {};
    const incomingRawUsage = {
      bytesIn, bytesOut, packetsIn: acctInputPackets,
      packetsOut: acctOutputPackets, duration: acctSessionTime,
    };
    if (current?.event_type === 'stop') {
      const sameFinalValue = (incoming, persisted) => {
        if (incoming === null || incoming === undefined) {
          // Omitted optional fields do not prove a new lifecycle. Treat an
          // otherwise matching delayed Stop conservatively as a replay; only
          // an explicit differing value may establish a missed-Start session.
          return true;
        }
        if (typeof incoming === 'number' || typeof persisted === 'number') {
          return Number(incoming) === Number(persisted);
        }
        return String(incoming) === String(persisted);
      };
      const sameStopPayload = eventType === 'stop' && [
        [bytesIn, currentRawUsage.bytesIn],
        [bytesOut, currentRawUsage.bytesOut],
        [acctInputPackets, currentRawUsage.packetsIn],
        [acctOutputPackets, currentRawUsage.packetsOut],
        [acctSessionTime, currentRawUsage.duration],
        [terminateCause, current.terminate_cause],
        [framedIpAddress, current.framed_ip],
        [framedIpv6Prefix, current.framed_ipv6_prefix],
      ].every(([incoming, persisted]) => sameFinalValue(incoming, persisted));
      const estimatedIncomingStart = observedEventAt.getTime()
        - Math.max(0, Number(acctSessionTime || 0)) * 1000;
      const isLaterReusedLifecycle = hasExplicitEventTimestamp && !sameStopPayload
        && observedEventAt.getTime() > currentObservedAt
        && estimatedIncomingStart >= currentObservedAt;
      if (isLaterReusedLifecycle) {
        // A NAS may reuse Acct-Session-Id and the new Start may have been lost.
        // Do not merge that connection into the older stopped lifecycle.
        current = null;
        currentRawUsage = {};
      }
    }
    if (current?.event_type === 'stop') {
      const authoritativeStopAt = new Date(current.last_accounting_at || current.event_at);
      const correctedFinal = eventType === 'stop' && (
        (bytesIn !== null && Number(bytesIn) > Number(currentRawUsage.bytesIn || 0))
        || (bytesOut !== null && Number(bytesOut) > Number(currentRawUsage.bytesOut || 0))
        || (acctInputPackets !== null && Number(acctInputPackets) > Number(currentRawUsage.packetsIn || 0))
        || (acctOutputPackets !== null && Number(acctOutputPackets) > Number(currentRawUsage.packetsOut || 0))
        || (acctSessionTime !== null && Number(acctSessionTime) > Number(currentRawUsage.duration || 0))
        || (terminateCause && terminateCause !== current.terminate_cause)
      );
      // A retransmitted Stop is a no-op unless it corrects final monotonic
      // counters/duration/cause. This accepts a correction at the same
      // Event-Timestamp while preventing receipt-time retries from producing
      // duplicate projections/evidence.
      if (correctedFinal && (!hasExplicitEventTimestamp
          || observedEventAt.getTime() >= currentObservedAt)) {
        const correctedUsage = calculateUsageDelta({
          previous: currentRawUsage,
          current: incomingRawUsage,
          previousEventAt: current.last_accounting_at || current.event_at,
          eventAt: observedEventAt,
          priorComplete: Boolean(current.usage_accounting_complete),
        });
        await lifecycleConnection.execute(
          `UPDATE connection_logs
              SET session_instance_id = COALESCE(session_instance_id, ?),
                  bytes_in = CASE WHEN ? IS NULL THEN bytes_in ELSE GREATEST(COALESCE(bytes_in, 0), ?) END,
                  bytes_out = CASE WHEN ? IS NULL THEN bytes_out ELSE GREATEST(COALESCE(bytes_out, 0), ?) END,
                  packets_in = CASE WHEN ? IS NULL THEN packets_in ELSE GREATEST(COALESCE(packets_in, 0), ?) END,
                  packets_out = CASE WHEN ? IS NULL THEN packets_out ELSE GREATEST(COALESCE(packets_out, 0), ?) END,
                  session_duration = CASE WHEN ? IS NULL THEN session_duration ELSE GREATEST(COALESCE(session_duration, 0), ?) END,
                  terminate_cause = COALESCE(?, terminate_cause),
                  last_accounting_at = ?, last_accounting_received_at = NOW(3),
                  acct_delay_seconds = ?,
                  usage_accounting_complete = ?,
                  usage_anomaly_count = usage_anomaly_count + ?,
                  usage_last_bytes_in = COALESCE(?, usage_last_bytes_in),
                  usage_last_bytes_out = COALESCE(?, usage_last_bytes_out),
                  usage_last_packets_in = COALESCE(?, usage_last_packets_in),
                  usage_last_packets_out = COALESCE(?, usage_last_packets_out),
                  usage_last_duration = COALESCE(?, usage_last_duration)
            WHERE id = ? AND organization_id = ? AND nas_id <=> ? AND event_type = 'stop'`,
          [currentInstanceId, bytesIn, bytesIn, bytesOut, bytesOut,
            acctInputPackets, acctInputPackets, acctOutputPackets,
            acctOutputPackets, acctSessionTime, acctSessionTime, terminateCause,
            authoritativeStopAt, delaySeconds,
            correctedUsage.nextSessionComplete ? 1 : 0,
            correctedUsage.sessionAnomalyCount,
            bytesIn, bytesOut, acctInputPackets, acctOutputPackets, acctSessionTime,
            current.id, organizationId, resolvedNasId],
        );
        await recordUsageDelta(lifecycleConnection, {
          organizationId, sessionInstanceId: currentInstanceId,
          connectionLogId: current.id, contractId: current.contract_id,
          clientId: current.client_id, nasId: current.nas_id,
          username: current.username, eventAt: observedEventAt,
          usage: correctedUsage,
        });
        await recordReceipt(lifecycleConnection, 'update', current.id);
        await lifecycleConnection.commit();
        lifecycleTransaction = false;
        return { action: 'update', id: current.id, macMove: false,
          sessionInstanceId: currentInstanceId };
      }
      await recordReceipt(lifecycleConnection, 'noop', current.id);
      await lifecycleConnection.commit();
      lifecycleTransaction = false;
      logger.debug({ organizationId, eventType }, 'Accounting replay after Stop ignored');
      return { action: 'noop', id: current.id, macMove: false,
        sessionInstanceId: currentInstanceId };
    }
    if (current && Number.isFinite(currentObservedAt)
      && observedEventAt.getTime() < currentObservedAt) {
      if (eventType === 'stop' && current.event_type !== 'stop') {
        await lifecycleConnection.execute(
          `UPDATE connection_logs
              SET event_type = 'stop', terminate_cause = COALESCE(?, terminate_cause),
                  last_accounting_at = ?, last_accounting_received_at = NOW(3),
                  acct_delay_seconds = ?, attribution_evidence_complete = 0,
                  attribution_anomaly_reason = 'out_of_order_stop',
                  usage_accounting_complete = 0,
                  usage_anomaly_count = usage_anomaly_count + 1
            WHERE id = ? AND organization_id = ? AND nas_id <=> ?
              AND event_type != 'stop'`,
          [terminateCause, observedEventAt, delaySeconds, current.id,
            organizationId, resolvedNasId],
        );
        await recordReceipt(lifecycleConnection, 'update', current.id);
        await lifecycleConnection.commit();
        lifecycleTransaction = false;
        logger.warn({ organizationId }, 'Out-of-order Stop closed and faulted accounting lifecycle');
        return { action: 'update', id: current.id, macMove: false,
          sessionInstanceId: currentInstanceId, attributionEvidenceComplete: false };
      }
      await recordReceipt(lifecycleConnection, 'noop', current.id);
      await lifecycleConnection.commit();
      lifecycleTransaction = false;
      logger.debug({ organizationId, eventType }, 'Out-of-order accounting update ignored');
      return { action: 'noop', id: current.id, macMove: false,
        sessionInstanceId: currentInstanceId };
    }

    if (current && framedIpAddress && current.framed_ip
        && framedIpAddress !== current.framed_ip) {
      throw new ValidationError('Framed-IP-Address changed within one access-session lifecycle; start a new accounting session instead');
    }
    if (current && framedIpv6Prefix && current.framed_ipv6_prefix
        && framedIpv6Prefix !== current.framed_ipv6_prefix) {
      throw new ValidationError('Framed-IPv6-Prefix changed within one access-session lifecycle; start a new accounting session instead');
    }

    const exactReplay = current
    && observedEventAt.getTime() === currentObservedAt
    && current.event_type === eventType
    && (bytesIn === null || Number(currentRawUsage.bytesIn || 0) === Number(bytesIn))
    && (bytesOut === null || Number(currentRawUsage.bytesOut || 0) === Number(bytesOut))
    && (acctInputPackets === null || Number(currentRawUsage.packetsIn || 0) === Number(acctInputPackets))
    && (acctOutputPackets === null || Number(currentRawUsage.packetsOut || 0) === Number(acctOutputPackets))
    && (acctSessionTime === null || Number(currentRawUsage.duration || 0) === Number(acctSessionTime))
    && (current.terminate_cause || null) === terminateCause
    && (!framedIpAddress || current.framed_ip === framedIpAddress)
    && (!framedIpv6Prefix || current.framed_ipv6_prefix === framedIpv6Prefix);
    if (exactReplay) {
      await recordReceipt(lifecycleConnection, 'noop', current.id);
      await lifecycleConnection.commit();
      lifecycleTransaction = false;
      logger.debug({ organizationId, eventType }, 'Duplicate accounting event ignored');
      return { action: 'noop', id: current.id, macMove: false,
        sessionInstanceId: currentInstanceId };
    }

    const acceptedUsage = current ? calculateUsageDelta({
      previous: currentRawUsage,
      current: incomingRawUsage,
      previousEventAt: current.last_accounting_at || current.event_at,
      eventAt: observedEventAt,
      priorComplete: Boolean(current.usage_accounting_complete),
    }) : null;

    if (current) await lifecycleConnection.execute(
      `UPDATE connection_logs
     SET session_instance_id   = COALESCE(session_instance_id, ?),
         event_type            = ?,
         bytes_in              = CASE WHEN ? IS NULL THEN bytes_in ELSE GREATEST(COALESCE(bytes_in, 0), ?) END,
         bytes_out             = CASE WHEN ? IS NULL THEN bytes_out ELSE GREATEST(COALESCE(bytes_out, 0), ?) END,
         packets_in            = CASE WHEN ? IS NULL THEN packets_in ELSE GREATEST(COALESCE(packets_in, 0), ?) END,
         packets_out           = CASE WHEN ? IS NULL THEN packets_out ELSE GREATEST(COALESCE(packets_out, 0), ?) END,
         session_duration      = CASE WHEN ? IS NULL THEN session_duration ELSE GREATEST(COALESCE(session_duration, 0), ?) END,
         terminate_cause       = ?,
         framed_ip             = COALESCE(?, framed_ip),
         framed_ipv6_prefix    = COALESCE(?, framed_ipv6_prefix),
         acct_input_octets_v6  = COALESCE(?, acct_input_octets_v6),
         acct_output_octets_v6 = COALESCE(?, acct_output_octets_v6),
         stack_type            = COALESCE(?, stack_type),
         last_accounting_at    = ?,
         last_accounting_received_at = NOW(3),
         acct_delay_seconds    = ?,
         usage_accounting_complete = ?,
         usage_anomaly_count = usage_anomaly_count + ?,
         usage_last_bytes_in = COALESCE(?, usage_last_bytes_in),
         usage_last_bytes_out = COALESCE(?, usage_last_bytes_out),
         usage_last_packets_in = COALESCE(?, usage_last_packets_in),
         usage_last_packets_out = COALESCE(?, usage_last_packets_out),
         usage_last_duration = COALESCE(?, usage_last_duration)
     WHERE id = ? AND organization_id = ? AND nas_id <=> ? AND event_type != 'stop'`,
      [
        currentInstanceId,
        eventType,
        bytesIn,
        bytesIn,
        bytesOut,
        bytesOut,
        acctInputPackets,
        acctInputPackets,
        acctOutputPackets,
        acctOutputPackets,
        acctSessionTime,
        acctSessionTime,
        terminateCause,
        framedIpAddress,
        framedIpv6Prefix,
        acctInputOctetsV6,
        acctOutputOctetsV6,
        stackType,
        observedEventAt,
        delaySeconds,
        acceptedUsage.nextSessionComplete ? 1 : 0,
        acceptedUsage.sessionAnomalyCount,
        bytesIn,
        bytesOut,
        acctInputPackets,
        acctOutputPackets,
        acctSessionTime,
        current.id,
        organizationId,
        resolvedNasId,
      ],
    );

    if (current) {
      await recordUsageDelta(lifecycleConnection, {
        organizationId, sessionInstanceId: currentInstanceId,
        connectionLogId: current.id, contractId: current.contract_id,
        clientId: current.client_id, nasId: current.nas_id,
        username: current.username, eventAt: observedEventAt,
        usage: acceptedUsage,
      });
      await recordReceipt(lifecycleConnection, 'update', current.id);
      await lifecycleConnection.commit();
      lifecycleTransaction = false;
      logger.debug({ organizationId, eventType }, 'connection_logs row updated');
      return { action: 'update', id: current.id, macMove: false,
        sessionInstanceId: currentInstanceId };
    }

    // Late / missed Start — retain the lifecycle, but baseline its cumulative
    // counters without treating unknown earlier usage as billable.
    logger.info({ organizationId, eventType }, 'No open session found — inserting late accounting row');
    const lateSessionInstanceId = crypto.randomUUID();
    const lateUsage = calculateUsageDelta({
      current: incomingRawUsage,
      eventAt: observedEventAt,
      priorComplete: false,
      baselineReason: 'missing_start_baseline',
      initializeBaseline: true,
    });
    const [lateInsert] = await lifecycleConnection.execute(
      `INSERT INTO connection_logs
       (username, contract_id, client_id, nas_id, nas_ip_address,
        acct_session_id, session_id,
        session_instance_id,
        nas_port_id, called_station_id, calling_station_id,
        framed_ip, framed_ipv6_prefix,
        event_type, event_at,
        bytes_in, bytes_out, packets_in, packets_out, session_duration, terminate_cause,
        acct_input_octets_v6, acct_output_octets_v6, stack_type,
        organization_id, last_accounting_at, last_accounting_received_at, acct_delay_seconds,
        attribution_evidence_complete, attribution_anomaly_reason,
        usage_accounting_complete, usage_anomaly_count,
        usage_last_bytes_in, usage_last_bytes_out,
        usage_last_packets_in, usage_last_packets_out, usage_last_duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userName,
        contractId,
        clientId,
        resolvedNasId,
        nasIpAddress,
        acctSessionId,
        acctSessionId,
        lateSessionInstanceId,
        nasPortId,
        calledStationId,
        callingStationId,
        framedIpAddress,
        framedIpv6Prefix,
        eventType,
        new Date(observedEventAt.getTime() - Math.max(0, acctSessionTime || 0) * 1000),
        bytesIn,
        bytesOut,
        acctInputPackets,
        acctOutputPackets,
        acctSessionTime,
        terminateCause,
        acctInputOctetsV6,
        acctOutputOctetsV6,
        stackType,
        organizationId,
        observedEventAt,
        delaySeconds,
        0,
        'missing_start',
        0,
        lateUsage.sessionAnomalyCount,
        bytesIn,
        bytesOut,
        acctInputPackets,
        acctOutputPackets,
        acctSessionTime,
      ],
    );

    await recordUsageDelta(lifecycleConnection, {
      organizationId, sessionInstanceId: lateSessionInstanceId,
      connectionLogId: lateInsert.insertId, contractId, clientId, nasId: resolvedNasId,
      username: userName, eventAt: observedEventAt,
      usage: lateUsage,
    });
    await recordReceipt(lifecycleConnection, 'insert', lateInsert.insertId);

    await lifecycleConnection.commit();
    lifecycleTransaction = false;
    return { action: 'insert', id: lateInsert.insertId, macMove: false,
      sessionInstanceId: lateSessionInstanceId };
  } catch (err) {
    if (lifecycleTransaction) await lifecycleConnection.rollback();
    throw err;
  } finally {
    let released = !lifecycleLock;
    if (lifecycleLock) {
      try {
        const [releaseRows] = await lifecycleConnection.execute(
          'SELECT RELEASE_LOCK(?) AS released',
          [lifecycleLockName],
        );
        released = Number(releaseRows[0]?.released) === 1;
      } catch (_err) { released = false; }
    }
    if (released) lifecycleConnection.release();
    else lifecycleConnection.destroy();
  }
}

async function recordInfrastructureAccounting({
  organizationId, nasId, acctStatusType, provenance = {},
}) {
  if (!Number.isSafeInteger(Number(organizationId)) || Number(organizationId) <= 0
      || !Number.isSafeInteger(Number(nasId)) || Number(nasId) <= 0
      || !['Accounting-On', 'Accounting-Off'].includes(acctStatusType)) {
    throw new ValidationError('Invalid NAS infrastructure accounting signal');
  }
  const bounded = (value, maximum) => {
    if (value === undefined || value === null || value === '') return null;
    return String(value).slice(0, maximum);
  };
  const payloadHash = crypto.createHash('sha256')
    .update(JSON.stringify([Number(organizationId), Number(nasId), acctStatusType]))
    .digest('hex');
  await db.query(
    `INSERT INTO collector_ingest_receipts
       (organization_id, source, api_token_id, nas_id, event_type, action, bucket_at,
        records_received, request_id, source_ip, user_agent, payload_chain_hash,
        first_received_at, last_received_at)
     VALUES (?, ?, ?, ?, ?, 'infrastructure',
             FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(NOW(3)) / 60) * 60),
             1, ?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       records_received = records_received + 1,
       last_received_at = VALUES(last_received_at),
       payload_chain_hash = SHA2(CONCAT(payload_chain_hash, ':', VALUES(payload_chain_hash)), 256)`,
    [Number(organizationId), bounded(provenance.source || 'radius_internal', 32),
      Number.isSafeInteger(Number(provenance.apiTokenId)) ? Number(provenance.apiTokenId) : 0,
      Number(nasId), acctStatusType,
      bounded(provenance.requestId, 64), bounded(provenance.sourceIp, 45),
      bounded(provenance.userAgent, 255), payloadHash],
  );
  return { action: 'noop', id: null, macMove: false };
}

// ---------------------------------------------------------------------------
// CDR Export
// ---------------------------------------------------------------------------

/**
 * Export CDRs from connection_logs.
 *
 * @param {object} opts
 * @param {string}           opts.from          - ISO date string (inclusive)
 * @param {string}           opts.to            - ISO date string (inclusive)
 * @param {string}           [opts.username]    - filter by RADIUS username
 * @param {'csv'|'json'}     [opts.format='json']
 * @param {number}           opts.organizationId
 * @returns {Promise<{format: string, rows?: object[], csv?: string}>}
 */
async function exportCdr(opts) {
  const {
    from,
    to,
    username = null,
    format = 'json',
    organizationId,
  } = opts;

  const strictDate = (value, field) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ValidationError(`${field} must be YYYY-MM-DD`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ValidationError(`${field} must be a real calendar date`);
    }
    return date;
  };
  const fromDate = strictDate(from, 'from');
  const toDate = strictDate(to, 'to');
  if (toDate < fromDate) throw new ValidationError('to must not be before from');
  if (toDate.getTime() - fromDate.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new ValidationError('CDR exports are limited to a 366-day window');
  }
  if (!['json', 'csv'].includes(format)) throw new ValidationError('format must be json or csv');
  if (username !== null && (typeof username !== 'string' || username.length > 64)) {
    throw new ValidationError('username must be at most 64 characters');
  }

  const conditions = ['cl.event_at >= ?', 'cl.event_at < DATE_ADD(?, INTERVAL 1 DAY)'];
  const params = [from, to];

  if (organizationId) {
    conditions.push('cl.organization_id = ?');
    params.push(organizationId);
  }

  if (username) {
    conditions.push('cl.username = ?');
    params.push(username);
  }

  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total FROM connection_logs cl
      WHERE ${conditions.join(' AND ')}`,
    params,
  );
  const total = Number(countRow?.total || 0);
  if (total > 50000) {
    const error = new ValidationError('CDR export exceeds the maximum row count', [{
      field: 'from', message: `query matches ${total} rows; narrow the dates to at most 50000`,
    }]);
    error.exportTotal = total;
    error.exportMax = 50000;
    throw error;
  }

  const [rows] = await db.query(
    `SELECT CASE WHEN cl.session_instance_id IS NULL THEN 'legacy_event' ELSE 'session' END AS record_kind,
            cl.session_id, cl.acct_session_id, cl.session_instance_id, cl.username,
            cl.event_type, cl.event_at, cl.event_at AS session_start,
            CASE WHEN cl.event_type = 'stop' THEN COALESCE(cl.last_accounting_at, cl.event_at) ELSE NULL END AS session_end,
            cl.session_duration, cl.bytes_in, cl.bytes_out,
            cl.nas_ip_address, cl.nas_port_id, cl.called_station_id, cl.calling_station_id,
            COALESCE(cl.framed_ip, cl.ip_address) AS framed_ip,
            cl.framed_ipv6_prefix, cl.terminate_cause,
            cl.acct_input_octets_v6, cl.acct_output_octets_v6, cl.stack_type
     FROM connection_logs cl
     WHERE ${conditions.join(' AND ')}
     ORDER BY cl.event_at ASC
     LIMIT 50001`,
    params,
  );
  if (rows.length > 50000) {
    const error = new ValidationError('CDR export changed during export and exceeds the maximum row count');
    error.exportTotal = Math.max(total, rows.length);
    error.exportMax = 50000;
    throw error;
  }

  if (format === 'csv') {
    const COLUMNS = [
      'record_kind', 'session_id', 'acct_session_id', 'session_instance_id', 'username', 'event_type', 'event_at', 'session_start', 'session_end',
      'session_duration', 'bytes_in', 'bytes_out',
      'nas_ip_address', 'nas_port_id', 'called_station_id', 'calling_station_id',
      'framed_ip', 'framed_ipv6_prefix', 'terminate_cause',
      'acct_input_octets_v6', 'acct_output_octets_v6', 'stack_type',
    ];
    const header = COLUMNS.join(',');
    const lines = rows.map((row) =>
      COLUMNS.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        let str = String(val);
        if (/^[\t\r\n =+\-@]/.test(str)) str = `'${str}`;
        // RFC 4180: quote fields that contain commas, double-quotes, or newlines.
        if (str.includes(',') || str.includes('"') || /[\r\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','),
    );
    return { format: 'csv', csv: [header, ...lines].join('\n') };
  }

  return { format: 'json', rows };
}

// ---------------------------------------------------------------------------
// Retention purge
// ---------------------------------------------------------------------------

/**
 * Purge old connection_logs rows beyond the configured retention window.
 *
 * The isolated-aware retention service fans out across the shared primary and
 * every active isolated tenant database. Session/evidence and usage deltas
 * default to 24 calendar months; privacy-minimal IP-attribution evidence also
 * uses calendar months and is capped at 24.
 *
 * @returns {Promise<{deleted: number}>}
 */
async function purgeRadiusAccounting() {
  const result = await require('./retentionService').runConnectionLogging();
  const tableErrors = result.tables.filter(table => table.error).length;
  if (tableErrors > 0 || result.scope_failures.length > 0) {
    const error = new Error(`Connection logging retention completed partially (${tableErrors} table errors, ${result.scope_failures.length} scope failures)`);
    error.retentionResult = result;
    throw error;
  }
  logger.info({ deleted: result.total_deleted }, 'Connection logging retention purge completed');
  return { deleted: result.total_deleted, ...result };
}

// ---------------------------------------------------------------------------
// MAC move event listing
// ---------------------------------------------------------------------------

/**
 * List MAC move events for an organisation, newest first.
 *
 * @param {number} organizationId
 * @param {object} [opts]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=25]
 * @returns {Promise<{rows: object[], total: number, page: number, limit: number}>}
 */
async function listMacMoveEvents(organizationId, { page = 1, limit = 25 } = {}) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 25);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const offset = (safePage - 1) * safeLimit;

  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM mac_move_events WHERE organization_id = ?',
    [organizationId],
  );

  const [rows] = await db.query(
    `SELECT id, organization_id, username,
            old_mac, new_mac,
            old_nas_id, new_nas_id,
            detected_at
     FROM mac_move_events
     WHERE organization_id = ?
     ORDER BY detected_at DESC
     LIMIT ${safeLimit} OFFSET ${offset}`,
    [organizationId],
  );

  return { rows, total, page, limit };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ingestAccounting,
  exportCdr,
  purgeRadiusAccounting,
  listMacMoveEvents,
  combineOctetsGigawords,
  deriveStackType,
  normalizeEventTimestamp,
  normalizeTerminateCause,
  calculateUsageDelta,
  recordInfrastructureAccounting,
};
