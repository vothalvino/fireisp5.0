// =============================================================================
// FireISP 5.0 — privacy-minimal CGNAT attribution ledger
// =============================================================================
// This service stores only the information needed to map a public IPv4/port/
// protocol at an exact instant to one tenant subscriber access session. It does
// not accept or retain destination addresses, destination ports, URLs, packet
// payloads, DNS names, byte counters, or browsing history.
//
// The binding table is an active/closed projection. Immutable allocate/release
// receipts preserve its lifecycle. A collector submits either one dynamic port
// binding or one exclusive port-block allocation. Exact replay is idempotent;
// conflicting reuse and nominally overlapping public allocations fail closed.
// Interactive attribution is possible only through a same-organization,
// approved government data request whose authorized tuple exactly matches it.
// =============================================================================

const crypto = require('crypto');
const net = require('net');
const db = require('../config/database');
const User = require('../models/User');
const { resolveOrgPrincipal } = require('./orgPrincipalService');
const { governmentRequestRowHashMatches } = require('../utils/govDataRequestIntegrity');
const {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} = require('../utils/errors');

const ABSOLUTE_MAX_BATCH = 1000;
const DEFAULT_MAX_BATCH = 500;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_CLOCK_UNCERTAINTY_MS = 300000;
const MAX_ABSOLUTE_CLOCK_OFFSET_MS = 86400000;

const BINDING_FIELDS = new Set([
  'event_type', 'binding_key', 'binding_type',
  'private_ipv4', 'private_port_start', 'private_port_end',
  'public_ipv4', 'public_port_start', 'public_port_end', 'protocol',
  'allocated_at', 'released_at',
  'client_id', 'contract_id', 'username', 'radius_session_id', 'session_instance_id',
  'exporter_nas_id', 'exporter_id', 'exporter_ip', 'exporter_boot_id',
  'nat_instance_id', 'nat_pool_id', 'nat_realm',
  'event_id', 'sequence_number', 'device_recorded_at',
  'clock_offset_ms', 'clock_uncertainty_ms', 'records_lost_before',
]);

const EXPORTER_FIELDS = new Set([
  'exporter_id', 'exporter_nas_id', 'exporter_ip', 'nat_instance_id',
  'nat_pool_id', 'nat_pool_record_id', 'nat_realm', 'purpose_reference', 'tuple_exclusivity_confirmed',
  'collector_api_token_id', 'authoritative_baseline_confirmed', 'baseline_reference',
  'is_required', 'enabled',
]);

const LOOKUP_FIELDS = new Set([
  'gov_data_request_id', 'public_ipv4', 'public_port', 'protocol', 'observed_at',
]);

const PROTOCOLS = Object.freeze({ tcp: 6, udp: 17 });
const PROTOCOL_NAMES = Object.freeze({ 6: 'tcp', 17: 'udp' });

function maxBatchSize() {
  const parsed = Number.parseInt(process.env.CGNAT_ATTRIBUTION_MAX_BATCH || '', 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_MAX_BATCH;
  return Math.min(parsed, ABSOLUTE_MAX_BATCH);
}

function positiveInteger(value, field, { allowZero = false, nullable = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new ValidationError(`${field} is required`, [{ field, message: `${field} is required` }]);
  }
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer` }]);
  }
  return value;
}

function signedInteger(value, field, { nullable = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new ValidationError(`${field} is required`, [{ field, message: `${field} is required` }]);
  }
  if (!Number.isSafeInteger(value) || Math.abs(value) > maximum) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be an integer between -${maximum} and ${maximum}` }]);
  }
  return value;
}

function port(value, field, { nullable = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new ValidationError(`${field} is required`, [{ field, message: `${field} is required` }]);
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be an integer from 1 to 65535` }]);
  }
  return value;
}

function requiredString(value, field, maximum) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be a non-empty string of at most ${maximum} characters` }]);
  }
  return value.trim();
}

function requiredAsciiString(value, field, maximum) {
  const normalized = requiredString(value, field, maximum);
  if (!/^[\x20-\x7E]+$/.test(normalized)) {
    throw new ValidationError(`Invalid ${field}`, [{
      field, message: `${field} must contain printable ASCII characters only`,
    }]);
  }
  return normalized;
}

function requiredSessionInstanceId(value) {
  const normalized = requiredAsciiString(value, 'session_instance_id', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new ValidationError('Invalid session_instance_id', [{
      field: 'session_instance_id', message: 'session_instance_id must be a canonical UUID from the tenant RADIUS session ledger',
    }]);
  }
  return normalized.toLowerCase();
}

function optionalString(value, field, maximum) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be a string of at most ${maximum} characters` }]);
  }
  return value;
}

function ipv4(value, field, { nullable = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new ValidationError(`${field} is required`, [{ field, message: `${field} is required` }]);
  }
  if (typeof value !== 'string' || net.isIP(value) !== 4) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be an IPv4 address` }]);
  }
  return value;
}

function isGloballyRoutableIpv4(value) {
  if (net.isIP(value) !== 4) return false;
  const [a, b, c] = value.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // RFC 6598 shared space
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv4(value, field = 'public_ipv4') {
  const address = ipv4(value, field);
  if (!isGloballyRoutableIpv4(address)) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be a globally routable unicast IPv4 address` }]);
  }
  return address;
}

function ipv4Number(value) {
  return value.split('.').reduce((result, octet) => result * 256 + Number(octet), 0);
}

function dateValue(value, field) {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T/.test(value)
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be an ISO 8601 date-time with a timezone` }]);
  }
  const parsed = new Date(value);
  const minimum = Date.UTC(1970, 0, 1);
  const maximum = Date.UTC(2038, 0, 19, 3, 14, 7);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() < minimum || parsed.getTime() > maximum) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} is outside the supported timestamp range` }]);
  }
  return parsed;
}

function normalizeProtocol(value, field = 'protocol') {
  if (Number.isInteger(value) && PROTOCOL_NAMES[value]) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (PROTOCOLS[normalized]) return PROTOCOLS[normalized];
    if (/^\d+$/.test(normalized) && PROTOCOL_NAMES[Number(normalized)]) return Number(normalized);
  }
  throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be tcp/6 or udp/17` }]);
}

function rejectUnknownFields(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be an object` }]);
  }
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (unexpected.length) {
    throw new ValidationError(`Unknown ${field} fields`, unexpected.map(key => ({
      field: `${field}.${key}`,
      message: 'field is not allowed',
    })));
  }
}

function canonicalJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeBinding(record, index = 0) {
  rejectUnknownFields(record, BINDING_FIELDS, `bindings[${index}]`);
  const eventType = requiredString(record.event_type, 'event_type', 16);
  if (!['allocate', 'release'].includes(eventType)) {
    throw new ValidationError('Invalid event_type', [{ field: 'event_type', message: 'event_type must be allocate or release' }]);
  }
  const bindingType = requiredString(record.binding_type, 'binding_type', 20);
  if (!['single_port', 'port_block'].includes(bindingType)) {
    throw new ValidationError('Invalid binding_type', [{ field: 'binding_type', message: 'binding_type must be single_port or port_block' }]);
  }

  const privatePortStart = port(record.private_port_start, 'private_port_start', { nullable: bindingType === 'port_block' });
  const privatePortEnd = port(record.private_port_end, 'private_port_end', { nullable: bindingType === 'port_block' });
  const publicPortStart = port(record.public_port_start, 'public_port_start');
  const publicPortEnd = port(record.public_port_end, 'public_port_end');
  if (bindingType === 'single_port'
      && (privatePortStart !== privatePortEnd || publicPortStart !== publicPortEnd)) {
    throw new ValidationError('Invalid single-port binding', [{ field: 'public_port_end', message: 'single_port bindings require equal start/end values for both private and public ports' }]);
  }
  if (bindingType === 'port_block' && (privatePortStart !== null || privatePortEnd !== null)) {
    throw new ValidationError('Invalid port-block allocation', [{ field: 'private_port_start', message: 'port_block allocations must omit private port fields' }]);
  }
  if (bindingType === 'port_block' && publicPortEnd <= publicPortStart) {
    throw new ValidationError('Invalid port-block allocation', [{ field: 'public_port_end', message: 'public_port_end must be greater than public_port_start' }]);
  }

  const allocatedAt = dateValue(record.allocated_at, 'allocated_at');
  const releasedAt = record.released_at === undefined || record.released_at === null || record.released_at === ''
    ? null : dateValue(record.released_at, 'released_at');
  if (eventType === 'allocate' && releasedAt !== null) {
    throw new ValidationError('Invalid allocate event', [{ field: 'released_at', message: 'allocate events must leave released_at null; send a separate release event' }]);
  }
  if (eventType === 'release' && releasedAt === null) {
    throw new ValidationError('Invalid release event', [{ field: 'released_at', message: 'release events require released_at' }]);
  }
  const duration = releasedAt ? releasedAt.getTime() - allocatedAt.getTime() : null;
  if (releasedAt && duration <= 0) {
    throw new ValidationError('Invalid allocation interval', [{ field: 'released_at', message: 'released_at must be after allocated_at' }]);
  }
  const configuredSkew = Number.parseInt(process.env.CGNAT_ATTRIBUTION_MAX_CLOCK_SKEW_SECONDS || '', 10);
  const maxSkew = Number.isSafeInteger(configuredSkew) && configuredSkew >= 0
    ? Math.min(configuredSkew, 3600) : DEFAULT_MAX_CLOCK_SKEW_SECONDS;
  if (allocatedAt.getTime() > Date.now() + maxSkew * 1000
      || (releasedAt && releasedAt.getTime() > Date.now() + maxSkew * 1000)) {
    throw new ValidationError('Allocation timestamp is in the future', [{ field: 'released_at', message: `completed allocation timestamps may be at most ${maxSkew} seconds in the future` }]);
  }

  const deviceRecordedAt = dateValue(record.device_recorded_at, 'device_recorded_at');
  const clockOffsetMs = signedInteger(record.clock_offset_ms, 'clock_offset_ms', {
    nullable: true, maximum: MAX_ABSOLUTE_CLOCK_OFFSET_MS,
  });
  const clockUncertaintyMs = record.clock_uncertainty_ms === null
    ? null
    : positiveInteger(record.clock_uncertainty_ms, 'clock_uncertainty_ms', { allowZero: true, nullable: true });
  if (clockUncertaintyMs !== null && clockUncertaintyMs > MAX_CLOCK_UNCERTAINTY_MS) {
    throw new ValidationError('Invalid clock_uncertainty_ms', [{ field: 'clock_uncertainty_ms', message: `clock_uncertainty_ms must not exceed ${MAX_CLOCK_UNCERTAINTY_MS}` }]);
  }
  // Sign convention: clock_offset_ms = raw device clock minus UTC. Subtracting
  // it produces the corrected UTC observation used for consistency checks.
  const correctedDeviceTime = deviceRecordedAt.getTime() - (clockOffsetMs || 0);
  const coverageHorizonTime = correctedDeviceTime
    - (clockUncertaintyMs === null ? MAX_CLOCK_UNCERTAINTY_MS : clockUncertaintyMs);
  if (correctedDeviceTime > Date.now() + maxSkew * 1000) {
    throw new ValidationError('Corrected device timestamp is in the future', [{ field: 'device_recorded_at', message: `corrected device_recorded_at may be at most ${maxSkew} seconds in the future` }]);
  }
  if (clockOffsetMs !== null && clockUncertaintyMs !== null) {
    const eventTime = eventType === 'release' ? releasedAt.getTime() : allocatedAt.getTime();
    if (Math.abs(correctedDeviceTime - eventTime) > clockUncertaintyMs) {
      throw new ValidationError('Device clock evidence is internally inconsistent', [{
        field: 'clock_offset_ms',
        message: 'device_recorded_at minus clock_offset_ms must agree with the event time within clock_uncertainty_ms',
      }]);
    }
  }

  return {
    event_type: eventType,
    binding_key: requiredAsciiString(record.binding_key, 'binding_key', 191),
    binding_type: bindingType,
    private_ipv4: ipv4(record.private_ipv4, 'private_ipv4'),
    private_port_start: privatePortStart,
    private_port_end: privatePortEnd,
    public_ipv4: publicIpv4(record.public_ipv4, 'public_ipv4'),
    public_port_start: publicPortStart,
    public_port_end: publicPortEnd,
    protocol: normalizeProtocol(record.protocol),
    allocated_at: allocatedAt,
    released_at: releasedAt,
    client_id: positiveInteger(record.client_id, 'client_id', { nullable: true }),
    contract_id: positiveInteger(record.contract_id, 'contract_id', { nullable: true }),
    username: optionalString(record.username, 'username', 64),
    radius_session_id: optionalString(record.radius_session_id, 'radius_session_id', 64),
    // Private address space may be reused by different access NASes/realms.
    // Require the canonical tenant session identity instead of guessing from a
    // private IPv4 and whatever subset of sessions happened to be visible.
    session_instance_id: requiredSessionInstanceId(record.session_instance_id),
    exporter_nas_id: positiveInteger(record.exporter_nas_id, 'exporter_nas_id', { nullable: true }),
    exporter_id: requiredAsciiString(record.exporter_id, 'exporter_id', 191),
    exporter_ip: ipv4(record.exporter_ip, 'exporter_ip', { nullable: true }),
    exporter_boot_id: requiredAsciiString(record.exporter_boot_id, 'exporter_boot_id', 191),
    nat_instance_id: requiredAsciiString(record.nat_instance_id, 'nat_instance_id', 191),
    nat_pool_id: requiredAsciiString(record.nat_pool_id, 'nat_pool_id', 191),
    nat_realm: requiredAsciiString(record.nat_realm, 'nat_realm', 191),
    event_id: requiredAsciiString(record.event_id, 'event_id', 191),
    sequence_number: positiveInteger(record.sequence_number, 'sequence_number', { allowZero: true }),
    device_recorded_at: deviceRecordedAt,
    corrected_device_at: new Date(correctedDeviceTime),
    coverage_horizon_at: new Date(coverageHorizonTime),
    clock_offset_ms: clockOffsetMs,
    clock_uncertainty_ms: clockUncertaintyMs,
    records_lost_before: record.records_lost_before === null
      ? null
      : positiveInteger(record.records_lost_before, 'records_lost_before', { allowZero: true, nullable: true }),
  };
}

function canonicalPayloadHash(organizationId, binding) {
  const canonical = { organization_id: organizationId };
  for (const key of [...BINDING_FIELDS].sort()) {
    const value = binding[key];
    canonical[key] = value instanceof Date ? value.toISOString() : (value ?? null);
  }
  return crypto.createHash('sha256').update(canonicalJson(canonical)).digest('hex');
}

async function resolveSession(connection, organizationId, binding) {
  const grace = Math.min(Math.max(
    Number.parseInt(process.env.CGNAT_ATTRIBUTION_SESSION_GRACE_SECONDS || '900', 10) || 900,
    0,
  ), 86400);
  const allocationUncertainty = binding.clock_uncertainty_ms ?? MAX_CLOCK_UNCERTAINTY_MS;
  const certainAllocationStart = new Date(
    binding.allocated_at.getTime() - allocationUncertainty,
  );
  const correlationEnd = new Date((binding.released_at || binding.allocated_at).getTime()
    + allocationUncertainty);
  const conditions = [
    'cl.organization_id = ?',
    'cl.attribution_evidence_complete = 1',
    'COALESCE(cl.framed_ip, cl.ip_address) = ?',
    'cl.event_at <= ?',
    `((cl.event_type = 'stop'
       AND COALESCE(cl.last_accounting_at,
         DATE_ADD(cl.event_at, INTERVAL COALESCE(cl.session_duration, 0) SECOND)) > ?)
      OR (cl.event_type <> 'stop'
       AND DATE_ADD(COALESCE(cl.last_accounting_at, cl.event_at), INTERVAL ? SECOND) >= ?))`,
  ];
  const params = [organizationId, binding.private_ipv4, certainAllocationStart,
    correlationEnd, grace, correlationEnd];
  if (binding.session_instance_id) {
    conditions.push('cl.session_instance_id = ?'); params.push(binding.session_instance_id);
  }
  if (binding.radius_session_id) {
    conditions.push('COALESCE(cl.acct_session_id, cl.session_id) = ?'); params.push(binding.radius_session_id);
  }
  if (binding.username) { conditions.push('cl.username = ?'); params.push(binding.username); }
  if (binding.client_id) { conditions.push('cl.client_id = ?'); params.push(binding.client_id); }
  if (binding.contract_id) { conditions.push('cl.contract_id = ?'); params.push(binding.contract_id); }

  const [rows] = await connection.execute(
    `SELECT cl.id AS connection_log_id, cl.client_id, cl.contract_id, cl.username,
            COALESCE(cl.acct_session_id, cl.session_id) AS radius_session_id,
            cl.session_instance_id
       FROM connection_logs cl
      WHERE ${conditions.join(' AND ')}
        AND cl.client_id IS NOT NULL AND cl.client_id <> 0
        AND cl.contract_id IS NOT NULL AND cl.contract_id <> 0
        AND cl.session_instance_id IS NOT NULL
      ORDER BY COALESCE(cl.last_accounting_at, cl.event_at) DESC, cl.id DESC
      LIMIT 2`,
    params,
  );
  if (rows.length !== 1) {
    throw new ValidationError('CGNAT binding cannot be attributed to exactly one access session', [{
      field: 'session_instance_id',
      message: rows.length === 0
        ? 'no tenant session covers the private IPv4 allocation interval'
        : 'multiple tenant sessions cover the private IPv4 allocation interval',
    }]);
  }
  const row = rows[0];
  if (!row.username || !row.radius_session_id) {
    throw new ValidationError('Access session identity is incomplete', [{ field: 'radius_session_id', message: 'the matched session must have username and RADIUS session identity' }]);
  }
  const [evidenceRows] = await connection.execute(
    `SELECT evidence.id, evidence.event_at, evidence.observed_at, evidence.integrity_hash
       FROM radius_accounting_events evidence
      WHERE evidence.organization_id = ?
        AND evidence.session_instance_id = ?
        AND evidence.framed_ip = ?
        AND evidence.event_at <= ?
        AND evidence.observed_at <= ?
      ORDER BY GREATEST(evidence.event_at, evidence.observed_at) DESC, evidence.id DESC
      LIMIT 1`,
    [organizationId, row.session_instance_id, binding.private_ipv4,
      certainAllocationStart, certainAllocationStart],
  );
  if (evidenceRows.length !== 1 || !evidenceRows[0].integrity_hash) {
    throw new ValidationError('Access session lacks a matching RADIUS evidence anchor', [{
      field: 'private_ipv4',
      message: 'a stored same-session RADIUS lifecycle event must anchor the private IPv4 before allocation',
    }]);
  }
  return {
    connection_log_id: Number(row.connection_log_id),
    client_id: Number(row.client_id),
    contract_id: Number(row.contract_id),
    username: row.username,
    radius_session_id: row.radius_session_id,
    session_instance_id: row.session_instance_id,
    radius_evidence_id: Number(evidenceRows[0].id),
    radius_evidence_event_at: evidenceRows[0].event_at,
    radius_evidence_observed_at: evidenceRows[0].observed_at,
    radius_evidence_integrity_hash: evidenceRows[0].integrity_hash,
  };
}

async function assertSessionCoversRelease(connection, organizationId, projection, binding) {
  const grace = Math.min(Math.max(
    Number.parseInt(process.env.CGNAT_ATTRIBUTION_SESSION_GRACE_SECONDS || '900', 10) || 900,
    0,
  ), 86400);
  const certainReleaseEnd = new Date(binding.released_at.getTime()
    + (binding.clock_uncertainty_ms ?? MAX_CLOCK_UNCERTAINTY_MS));
  const [rows] = await connection.execute(
    `SELECT cl.id
       FROM connection_logs cl
      WHERE cl.id = ? AND cl.organization_id = ?
        AND cl.attribution_evidence_complete = 1
        AND cl.session_instance_id = ?
        AND COALESCE(cl.framed_ip, cl.ip_address) = ?
        AND (
          (cl.event_type = 'stop' AND EXISTS (
            SELECT 1 FROM radius_accounting_events stop_evidence
             WHERE stop_evidence.organization_id = cl.organization_id
               AND stop_evidence.session_instance_id = cl.session_instance_id
               AND stop_evidence.status_type = 'stop'
               AND stop_evidence.framed_ip = ?
               AND DATE_ADD(stop_evidence.event_at, INTERVAL ? SECOND) >= ?
               AND DATE_ADD(stop_evidence.observed_at, INTERVAL ? SECOND) >= ?
          ))
          OR
          (cl.event_type <> 'stop'
            AND DATE_ADD(COALESCE(cl.last_accounting_at, cl.event_at), INTERVAL ? SECOND) >= ?)
        )
      LIMIT 1`,
    [Number(projection.connection_log_id), organizationId, projection.session_instance_id,
      projection.private_ipv4, projection.private_ipv4, grace, certainReleaseEnd,
      grace, certainReleaseEnd,
      grace, certainReleaseEnd],
  );
  if (rows.length !== 1) {
    throw new ValidationError('Release is not covered by the attributed access session', [{
      field: 'released_at',
      message: 'the same RADIUS session and stored lifecycle evidence must cover the release time',
    }]);
  }
}

async function resolveExporterConfig(connection, organizationId, binding, apiTokenId) {
  const [rows] = await connection.execute(
    `SELECT * FROM cgnat_exporter_configs
      WHERE organization_id = ? AND exporter_id = ? AND nat_instance_id = ?
        AND nat_pool_id = ? AND nat_realm = ? AND enabled = 1
      LIMIT 2 FOR UPDATE`,
    [organizationId, binding.exporter_id, binding.nat_instance_id,
      binding.nat_pool_id, binding.nat_realm],
  );
  if (rows.length !== 1) {
    throw new ValidationError('CGNAT exporter is not uniquely configured for this organization', [{
      field: 'exporter_id', message: 'register and enable the exact exporter/NAT instance/pool/realm before ingest',
    }]);
  }
  const config = rows[0];
  const primaryToken = Number(config.collector_api_token_id) === Number(apiTokenId);
  const recoveryToken = config.recovery_collector_api_token_id !== null
    && config.recovery_collector_api_token_id !== undefined
    && Number(config.recovery_collector_api_token_id) === Number(apiTokenId);
  if (!primaryToken && !recoveryToken) {
    throw new ForbiddenError('Collector token is not bound to this CGNAT exporter configuration');
  }
  if (recoveryToken && (binding.event_type !== 'release'
      || !config.recovery_approved_at || !String(config.recovery_reference || '').trim())) {
    throw new ForbiddenError('The incident-recovery collector may submit release events only');
  }
  config.ingest_collector_api_token_id = Number(apiTokenId);
  config.recovery_release = recoveryToken;
  if (binding.exporter_nas_id && Number(config.exporter_nas_id) !== binding.exporter_nas_id) {
    throw new ValidationError('Exporter NAS mismatch', [{ field: 'exporter_nas_id', message: 'exporter_nas_id does not match the configured exporter' }]);
  }
  if (binding.exporter_ip && binding.exporter_ip !== (config.exporter_ip || null)) {
    throw new ValidationError('Exporter IP mismatch', [{ field: 'exporter_ip', message: 'exporter_ip does not match the configured exporter' }]);
  }
  const approvedAt = config.collection_approved_at
    ? new Date(config.collection_approved_at).getTime() : Number.NaN;
  const baselineAt = config.baseline_confirmed_at
    ? new Date(config.baseline_confirmed_at).getTime() : Number.NaN;
  const allocationLowerBound = binding.allocated_at.getTime()
    - (binding.clock_uncertainty_ms ?? MAX_CLOCK_UNCERTAINTY_MS);
  if (!Number(config.authoritative_baseline_confirmed)
      || !String(config.baseline_reference || '').trim()
      || !Number.isFinite(approvedAt) || !Number.isFinite(baselineAt)
      || (binding.event_type === 'allocate' && allocationLowerBound < approvedAt)
      || (binding.event_type === 'allocate' && allocationLowerBound < baselineAt)
      || binding.coverage_horizon_at.getTime() < approvedAt
      || binding.coverage_horizon_at.getTime() < baselineAt) {
    throw new ValidationError('CGNAT event predates the approved collection purpose or authoritative baseline', [{
      field: 'allocated_at',
      message: 'the event certainty interval must not predate collection approval or the authoritative baseline',
    }]);
  }
  binding.exporter_nas_id = config.exporter_nas_id ? Number(config.exporter_nas_id) : null;
  binding.exporter_ip = config.exporter_ip || null;
  const publicNumber = ipv4Number(binding.public_ipv4);
  if (publicNumber < ipv4Number(config.public_ipv4_start)
      || publicNumber > ipv4Number(config.public_ipv4_end)) {
    throw new ValidationError('Public IPv4 is outside the configured NAT pool', [{ field: 'public_ipv4', message: 'public_ipv4 must belong to the exporter configuration public range' }]);
  }
  return config;
}

function sequenceState(config, binding, { bootSeenBefore = false } = {}) {
  if (!config.last_exporter_boot_id) {
    return binding.sequence_number <= 1
      ? { status: 'initial', missing: 0, advances: true }
      : { status: 'gap', missing: binding.sequence_number - 1, advances: true };
  }
  if (config.last_exporter_boot_id !== binding.exporter_boot_id) {
    if (bootSeenBefore || (config.last_corrected_device_at
        && binding.corrected_device_at.getTime()
          <= new Date(config.last_corrected_device_at).getTime())) {
      return { status: 'out_of_order', missing: 0, advances: false };
    }
    // A device/normalizer restart cannot prove that pre-existing mappings were
    // carried across the boot boundary. Fault this evidence epoch even when the
    // new sequence begins at 0/1. Operators must drain/reconcile the pool and
    // approve a new versioned exporter epoch before positive attribution.
    return { status: 'gap', missing: Math.max(0, binding.sequence_number - 1), advances: false };
  }
  if (config.last_corrected_device_at
      && binding.corrected_device_at.getTime()
        < new Date(config.last_corrected_device_at).getTime()) {
    return { status: 'out_of_order', missing: 0, advances: false };
  }
  const last = Number(config.last_sequence_number);
  if (binding.sequence_number === last + 1) return { status: 'contiguous', missing: 0, advances: true };
  if (binding.sequence_number > last + 1) {
    return { status: 'gap', missing: binding.sequence_number - last - 1, advances: true };
  }
  return { status: 'out_of_order', missing: 0, advances: false };
}

function certainlyCoversInstant(binding, observedAt) {
  const observed = new Date(observedAt).getTime();
  const allocationUncertainty = binding.allocation_clock_uncertainty_ms === null
    || binding.allocation_clock_uncertainty_ms === undefined
    ? MAX_CLOCK_UNCERTAINTY_MS : Number(binding.allocation_clock_uncertainty_ms);
  const certainStart = new Date(binding.allocated_at).getTime() + allocationUncertainty;
  if (observed < certainStart) return false;
  if (!binding.released_at) return true;
  const releaseUncertainty = binding.release_clock_uncertainty_ms === null
    || binding.release_clock_uncertainty_ms === undefined
    ? MAX_CLOCK_UNCERTAINTY_MS : Number(binding.release_clock_uncertainty_ms);
  const certainEnd = new Date(binding.released_at).getTime() - releaseUncertainty;
  return observed < certainEnd;
}

async function assertExclusivePublicAllocation(connection, organizationId, binding) {
  await connection.execute(
    `INSERT INTO cgnat_public_tuple_locks (organization_id, public_ipv4, protocol)
     VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE updated_at = updated_at`,
    [organizationId, binding.public_ipv4, binding.protocol],
  );
  await connection.execute(
    `SELECT id FROM cgnat_public_tuple_locks
      WHERE organization_id = ? AND public_ipv4 = ? AND protocol = ? FOR UPDATE`,
    [organizationId, binding.public_ipv4, binding.protocol],
  );

  const nominalEnd = binding.released_at
    ? binding.released_at
    : new Date(Date.UTC(2038, 0, 19, 3, 14, 7));
  const [rows] = await connection.execute(
    `SELECT id, allocated_at, released_at
       FROM cgnat_attribution_bindings
      WHERE organization_id = ? AND public_ipv4 = ? AND protocol = ?
        AND public_port_start <= ? AND public_port_end >= ?
        AND allocated_at < ? AND (released_at IS NULL OR released_at > ?)
      LIMIT 50 FOR UPDATE`,
    [organizationId, binding.public_ipv4, binding.protocol,
      binding.public_port_end, binding.public_port_start, nominalEnd, binding.allocated_at],
  );
  if (rows.length) {
    throw new ConflictError('Public CGNAT tuple overlaps an existing subscriber allocation on the nominal half-open interval');
  }
}

function metadataComplete(binding) {
  return binding.clock_offset_ms !== null
    && binding.clock_uncertainty_ms !== null
    && binding.records_lost_before !== null;
}

async function ingestBatch(organizationId, payload, provenance = {}) {
  positiveInteger(organizationId, 'organization_id');
  rejectUnknownFields(payload, new Set(['bindings']), 'body');
  if (!Array.isArray(payload.bindings) || payload.bindings.length === 0) {
    throw new ValidationError('Invalid binding batch', [{ field: 'bindings', message: 'bindings must be a non-empty array' }]);
  }
  const limit = maxBatchSize();
  if (payload.bindings.length > limit) {
    throw new ValidationError('Binding batch too large', [{ field: 'bindings', message: `bindings may contain at most ${limit} records` }]);
  }
  const bindings = payload.bindings.map(normalizeBinding);
  const batchHash = crypto.createHash('sha256')
    .update(canonicalJson(bindings.map(binding => canonicalPayloadHash(organizationId, binding))))
    .digest('hex');
  const safeProvenance = (value, maximum) => {
    if (value === undefined || value === null || value === '') return null;
    return String(value).slice(0, maximum);
  };

  const connection = await db.getConnection();
  let inserted = 0;
  let replayed = 0;
  let allocated = 0;
  let released = 0;
  const sequence = { initial: 0, contiguous: 0, reset: 0, gap: 0, out_of_order: 0 };
  let incompleteMetadata = 0;
  try {
    await connection.beginTransaction();
    for (const binding of bindings) {
      const payloadHash = canonicalPayloadHash(organizationId, binding);
      const exporter = await resolveExporterConfig(connection, organizationId, binding, provenance.apiTokenId);
      const [existing] = await connection.execute(
        `SELECT payload_hash, collector_api_token_id FROM cgnat_binding_events
          WHERE organization_id = ? AND exporter_config_id = ? AND exporter_boot_id = ?
            AND event_id = ? LIMIT 1`,
        [organizationId, Number(exporter.id), binding.exporter_boot_id, binding.event_id],
      );
      if (existing.length) {
        if (Number(existing[0].collector_api_token_id) !== Number(provenance.apiTokenId)) {
          throw new ForbiddenError('Collector token is not authorized to replay this exporter event');
        }
        if (existing[0].payload_hash !== payloadHash) {
          throw new ConflictError('The same exporter boot/event identity was already stored with different content');
        }
        replayed += 1;
        continue;
      }

      let bootSeenBefore = false;
      if (exporter.last_exporter_boot_id
          && exporter.last_exporter_boot_id !== binding.exporter_boot_id) {
        const [seenBoot] = await connection.execute(
          `SELECT id FROM cgnat_binding_events
            WHERE organization_id = ? AND exporter_config_id = ? AND exporter_boot_id = ?
            LIMIT 1`,
          [organizationId, Number(exporter.id), binding.exporter_boot_id],
        );
        bootSeenBefore = seenBoot.length > 0;
      }
      const sequenceInfo = sequenceState(exporter, binding, { bootSeenBefore });
      sequence[sequenceInfo.status] += 1;
      if (!metadataComplete(binding)) incompleteMetadata += 1;
      let projectionId;
      let session;
      let eventIntegrityHash;

      if (binding.event_type === 'allocate') {
        const [sameKey] = await connection.execute(
          `SELECT id FROM cgnat_attribution_bindings
            WHERE organization_id = ? AND exporter_config_id = ? AND binding_key = ?
            LIMIT 1 FOR UPDATE`,
          [organizationId, Number(exporter.id), binding.binding_key],
        );
        if (sameKey.length) {
          throw new ConflictError('binding_key already identifies a different allocation event');
        }
        session = await resolveSession(connection, organizationId, binding);
        await assertExclusivePublicAllocation(connection, organizationId, binding);
        eventIntegrityHash = crypto.createHash('sha256').update(canonicalJson({
          payload_hash: payloadHash,
          organization_id: organizationId,
          exporter_config_id: Number(exporter.id),
          collector_api_token_id: Number(exporter.ingest_collector_api_token_id),
          ...session,
        })).digest('hex');
        const [projectionResult] = await connection.execute(
          `INSERT INTO cgnat_attribution_bindings
            (organization_id, exporter_config_id, connection_log_id,
             client_id, contract_id, username, radius_session_id, session_instance_id,
             radius_evidence_id, radius_evidence_event_at, radius_evidence_observed_at,
             radius_evidence_integrity_hash,
             binding_key, binding_type, private_ipv4, private_port_start, private_port_end,
             public_ipv4, public_port_start, public_port_end, protocol,
             allocated_at, released_at, exporter_nas_id, collector_api_token_id,
             exporter_id, exporter_ip,
             exporter_boot_id, nat_instance_id, nat_pool_id, nat_realm,
             allocation_event_id, allocation_sequence_number, allocation_sequence_status,
             allocation_device_recorded_at, allocation_received_at,
             allocation_clock_offset_ms, allocation_clock_uncertainty_ms,
             allocation_records_lost_before,
             metadata_complete, payload_hash, integrity_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?)`,
          [organizationId, Number(exporter.id), session.connection_log_id,
            session.client_id, session.contract_id, session.username,
            session.radius_session_id, session.session_instance_id,
            session.radius_evidence_id, session.radius_evidence_event_at,
            session.radius_evidence_observed_at,
            session.radius_evidence_integrity_hash,
            binding.binding_key, binding.binding_type, binding.private_ipv4,
            binding.private_port_start, binding.private_port_end,
            binding.public_ipv4, binding.public_port_start, binding.public_port_end,
            binding.protocol, binding.allocated_at, binding.exporter_nas_id,
            Number(exporter.ingest_collector_api_token_id),
            binding.exporter_id, binding.exporter_ip, binding.exporter_boot_id,
            binding.nat_instance_id, binding.nat_pool_id, binding.nat_realm,
            binding.event_id, binding.sequence_number, sequenceInfo.status,
            binding.device_recorded_at, binding.clock_offset_ms,
            binding.clock_uncertainty_ms, binding.records_lost_before,
            metadataComplete(binding) ? 1 : 0, payloadHash, eventIntegrityHash],
        );
        projectionId = Number(projectionResult.insertId);
        allocated += 1;
      } else {
        const [projectionRows] = await connection.execute(
          `SELECT * FROM cgnat_attribution_bindings
            WHERE organization_id = ? AND exporter_config_id = ? AND binding_key = ?
            LIMIT 2 FOR UPDATE`,
          [organizationId, Number(exporter.id), binding.binding_key],
        );
        if (projectionRows.length !== 1) {
          throw new ValidationError('Release event has no unique allocation', [{ field: 'binding_key', message: 'binding_key must identify one existing allocation' }]);
        }
        const projection = projectionRows[0];
        if (projection.released_at) throw new ConflictError('CGNAT allocation is already released');
        const mismatches = [
          ['binding_type', binding.binding_type], ['private_ipv4', binding.private_ipv4],
          ['private_port_start', binding.private_port_start], ['private_port_end', binding.private_port_end],
          ['public_ipv4', binding.public_ipv4], ['public_port_start', binding.public_port_start],
          ['public_port_end', binding.public_port_end], ['protocol', binding.protocol],
          ['nat_instance_id', binding.nat_instance_id], ['nat_pool_id', binding.nat_pool_id],
          ['nat_realm', binding.nat_realm],
        ].filter(([field, value]) => String(projection[field] ?? '') !== String(value ?? ''));
        const identityHints = [
          ['client_id', binding.client_id], ['contract_id', binding.contract_id],
          ['username', binding.username], ['radius_session_id', binding.radius_session_id],
          ['session_instance_id', binding.session_instance_id],
        ].filter(([, value]) => value !== null && value !== undefined)
          .filter(([field, value]) => String(projection[field] ?? '') !== String(value));
        if (mismatches.length || identityHints.length
            || new Date(projection.allocated_at).getTime() !== binding.allocated_at.getTime()) {
          throw new ConflictError('Release event tuple does not match the stored allocation');
        }
        if (binding.released_at.getTime() <= new Date(projection.allocated_at).getTime()) {
          throw new ValidationError('Invalid release interval', [{ field: 'released_at', message: 'release must be after allocation' }]);
        }
        await assertSessionCoversRelease(connection, organizationId, projection, binding);
        session = {
          connection_log_id: Number(projection.connection_log_id),
          client_id: Number(projection.client_id),
          contract_id: Number(projection.contract_id),
          username: projection.username,
          radius_session_id: projection.radius_session_id,
          session_instance_id: projection.session_instance_id,
          radius_evidence_id: Number(projection.radius_evidence_id),
          radius_evidence_event_at: projection.radius_evidence_event_at,
          radius_evidence_observed_at: projection.radius_evidence_observed_at,
          radius_evidence_integrity_hash: projection.radius_evidence_integrity_hash,
        };
        eventIntegrityHash = crypto.createHash('sha256').update(canonicalJson({
          payload_hash: payloadHash,
          organization_id: organizationId,
          exporter_config_id: Number(exporter.id),
          collector_api_token_id: Number(exporter.ingest_collector_api_token_id),
          ...session,
        })).digest('hex');
        const [updateResult] = await connection.execute(
          `UPDATE cgnat_attribution_bindings
              SET released_at = ?, release_event_id = ?, release_sequence_number = ?,
                  release_sequence_status = ?, release_device_recorded_at = ?,
                  release_received_at = NOW(3),
                  release_clock_offset_ms = ?, release_clock_uncertainty_ms = ?,
                  release_records_lost_before = ?,
                  metadata_complete = metadata_complete AND ?,
                  integrity_hash = SHA2(CONCAT(integrity_hash, ':', ?), 256)
            WHERE id = ? AND organization_id = ? AND released_at IS NULL`,
          [binding.released_at, binding.event_id, binding.sequence_number,
            sequenceInfo.status, binding.device_recorded_at,
            binding.clock_offset_ms, binding.clock_uncertainty_ms,
            binding.records_lost_before, metadataComplete(binding) ? 1 : 0,
            eventIntegrityHash,
            projection.id, organizationId],
        );
        if (Number(updateResult.affectedRows) !== 1) throw new ConflictError('CGNAT allocation changed before release was recorded');
        projectionId = Number(projection.id);
        released += 1;
      }

      await connection.execute(
        `INSERT INTO cgnat_binding_events
          (organization_id, binding_id, exporter_config_id, collector_api_token_id,
           event_type, binding_key,
           exporter_id, exporter_boot_id, event_id, sequence_number, sequence_status,
           device_recorded_at, received_at, clock_offset_ms, clock_uncertainty_ms,
           records_lost_before, allocated_at, released_at, payload_hash, integrity_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, ?)`,
        [organizationId, projectionId, Number(exporter.id), Number(exporter.ingest_collector_api_token_id), binding.event_type,
          binding.binding_key, binding.exporter_id, binding.exporter_boot_id,
          binding.event_id, binding.sequence_number, sequenceInfo.status,
          binding.device_recorded_at, binding.clock_offset_ms,
          binding.clock_uncertainty_ms, binding.records_lost_before,
          binding.allocated_at, binding.released_at, payloadHash, eventIntegrityHash],
      );
      inserted += 1;

      await connection.execute(
        `UPDATE cgnat_exporter_configs
            SET last_binding_received_at = NOW(3),
                last_device_recorded_at = CASE
                  WHEN ? = 1 AND (last_corrected_device_at IS NULL OR last_corrected_device_at < ?)
                    THEN ? ELSE last_device_recorded_at END,
                last_corrected_device_at = CASE
                  WHEN ? = 1 AND (last_corrected_device_at IS NULL OR last_corrected_device_at < ?)
                    THEN ? ELSE last_corrected_device_at END,
                coverage_horizon_at = CASE
                  WHEN ? = 1 AND (coverage_horizon_at IS NULL OR coverage_horizon_at < ?)
                    THEN ? ELSE coverage_horizon_at END,
                last_exporter_boot_id = CASE WHEN ? = 1 THEN ? ELSE last_exporter_boot_id END,
                last_sequence_number = CASE WHEN ? = 1 THEN ? ELSE last_sequence_number END,
                sequence_gap_events = sequence_gap_events + ?,
                sequence_missing_records = sequence_missing_records + ?,
                out_of_order_events = out_of_order_events + ?,
                reported_lost_records = reported_lost_records + COALESCE(?, 0),
                incomplete_metadata_events = incomplete_metadata_events + ?
          WHERE id = ? AND organization_id = ?`,
        [sequenceInfo.advances ? 1 : 0, binding.corrected_device_at,
          binding.device_recorded_at,
          sequenceInfo.advances ? 1 : 0, binding.corrected_device_at,
          binding.corrected_device_at,
          sequenceInfo.advances ? 1 : 0, binding.coverage_horizon_at,
          binding.coverage_horizon_at,
          sequenceInfo.advances ? 1 : 0, binding.exporter_boot_id,
          sequenceInfo.advances ? 1 : 0, binding.sequence_number,
          sequenceInfo.status === 'gap' ? 1 : 0, sequenceInfo.missing,
          sequenceInfo.status === 'out_of_order' ? 1 : 0,
          binding.records_lost_before, metadataComplete(binding) ? 0 : 1,
          Number(exporter.id), organizationId],
      );
    }

    await connection.execute(
      `INSERT INTO collector_ingest_receipts
        (organization_id, source, api_token_id, nas_id, event_type, action, bucket_at,
         records_received, records_inserted, records_replayed, request_id, source_ip,
         user_agent, payload_chain_hash, first_received_at, last_received_at)
       VALUES (?, 'cgnat_api', ?, 0, 'binding_batch', 'batch',
               FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(NOW(3)) / 60) * 60),
               ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE
         records_received = records_received + VALUES(records_received),
         records_inserted = records_inserted + VALUES(records_inserted),
         records_replayed = records_replayed + VALUES(records_replayed),
         last_received_at = VALUES(last_received_at),
         payload_chain_hash = SHA2(CONCAT(payload_chain_hash, ':', VALUES(payload_chain_hash)), 256)`,
      [organizationId,
        Number.isSafeInteger(Number(provenance.apiTokenId)) ? Number(provenance.apiTokenId) : 0,
        bindings.length, inserted, replayed,
        safeProvenance(provenance.requestId, 64), safeProvenance(provenance.sourceIp, 45),
        safeProvenance(provenance.userAgent, 255), batchHash],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return {
    received: bindings.length, inserted, replayed, allocated, released,
    incomplete_metadata: incompleteMetadata, sequence,
  };
}

function normalizeLookup(value) {
  rejectUnknownFields(value, LOOKUP_FIELDS, 'body');
  const hasPort = value.public_port !== undefined && value.public_port !== null && value.public_port !== '';
  const hasProtocol = value.protocol !== undefined && value.protocol !== null && value.protocol !== '';
  if (hasPort !== hasProtocol) {
    throw new ValidationError('Incomplete public tuple', [{ field: 'public_port', message: 'public_port and protocol must be supplied together for CGNAT attribution, or both omitted for direct public assignment' }]);
  }
  const observedAt = dateValue(value.observed_at, 'observed_at');
  if (observedAt.getTime() > Date.now()) {
    throw new ValidationError('Future attribution queries are not allowed', [{ field: 'observed_at', message: 'observed_at must not be in the future' }]);
  }
  return {
    gov_data_request_id: positiveInteger(value.gov_data_request_id, 'gov_data_request_id'),
    public_ipv4: publicIpv4(value.public_ipv4, 'public_ipv4'),
    public_port: hasPort ? port(value.public_port, 'public_port') : null,
    protocol: hasProtocol ? normalizeProtocol(value.protocol) : null,
    observed_at: observedAt,
  };
}

function sameInstant(left, right) {
  return left && right && new Date(left).getTime() === new Date(right).getTime();
}

async function loadAuthorizedCase(organizationId, lookup) {
  const [[request]] = await db.query(
    `SELECT id, organization_id, request_type, status, authority_name,
            authority_ref, legal_basis, legal_reviewed_at, legal_reviewed_by,
            row_hash, client_id, contract_id, ip_address, public_port, protocol,
            observed_at, created_at
       FROM gov_data_requests WHERE id = ? AND organization_id = ? LIMIT 1`,
    [lookup.gov_data_request_id, organizationId],
  );
  if (!request) throw new NotFoundError('Government data request');
  if (request.request_type !== 'ip_traceability' || request.status !== 'processing'
      || !String(request.authority_ref || '').trim() || !String(request.legal_basis || '').trim()
      || !String(request.row_hash || '').trim()) {
    throw new ForbiddenError('IP attribution requires an approved processing ip_traceability request with authority reference and legal basis');
  }
  if (!governmentRequestRowHashMatches(request)) {
    throw new ForbiddenError('Government request consistency marker does not match the stored request');
  }
  let caseProtocol = null;
  if (request.protocol !== null && request.protocol !== undefined && request.protocol !== '') {
    try { caseProtocol = normalizeProtocol(request.protocol); } catch (_error) { caseProtocol = null; }
  }
  const casePort = request.public_port === null || request.public_port === undefined
    ? null : Number(request.public_port);
  if (request.ip_address !== lookup.public_ipv4
      || casePort !== lookup.public_port
      || caseProtocol !== lookup.protocol
      || !sameInstant(request.observed_at, lookup.observed_at)) {
    throw new ForbiddenError('Lookup tuple and exact time must match the approved government request');
  }
  return request;
}

function assertAuthorizedCaseSubject(request, attribution) {
  if (request.client_id !== null && request.client_id !== undefined
      && Number(request.client_id) !== Number(attribution.client_id)) {
    throw new ForbiddenError('Attributed subscriber does not match the approved case subject');
  }
  if (request.contract_id !== null && request.contract_id !== undefined
      && Number(request.contract_id) !== Number(attribution.contract_id)) {
    throw new ForbiddenError('Attributed contract does not match the approved case subject');
  }
}

function publicAttribution(row) {
  const allocationUncertainty = row.allocation_clock_uncertainty_ms === null
    || row.allocation_clock_uncertainty_ms === undefined
    ? MAX_CLOCK_UNCERTAINTY_MS : Number(row.allocation_clock_uncertainty_ms);
  const certainFrom = new Date(new Date(row.allocated_at).getTime() + allocationUncertainty);
  const bindingCertainUntil = row.released_at
    ? new Date(new Date(row.released_at).getTime()
      - (row.release_clock_uncertainty_ms === null
        || row.release_clock_uncertainty_ms === undefined
        ? MAX_CLOCK_UNCERTAINTY_MS : Number(row.release_clock_uncertainty_ms)))
    : new Date(row.exporter_coverage_horizon_at);
  const accessCertainUntil = row.access_session_event_type === 'stop'
    ? new Date(Math.min(new Date(row.access_session_stop_event_at).getTime(),
      new Date(row.access_session_stop_observed_at).getTime()))
    : new Date(Math.min(new Date(row.access_session_last_accounting_at).getTime(),
      new Date(row.access_session_last_accounting_received_at).getTime()));
  const certainUntil = new Date(Math.min(
    bindingCertainUntil.getTime(), accessCertainUntil.getTime(),
  ));
  return {
    binding_id: Number(row.id),
    binding_type: row.binding_type,
    client_id: Number(row.client_id),
    client_name: row.client_name || null,
    contract_id: Number(row.contract_id),
    username: row.username,
    radius_session_id: row.radius_session_id,
    session_instance_id: row.session_instance_id,
    connection_log_id: Number(row.connection_log_id),
    radius_evidence_id: Number(row.radius_evidence_id),
    radius_evidence_event_at: new Date(row.radius_evidence_event_at).toISOString(),
    radius_evidence_observed_at: new Date(row.radius_evidence_observed_at).toISOString(),
    radius_evidence_integrity_hash: row.radius_evidence_integrity_hash,
    private_ipv4: row.private_ipv4,
    private_port_start: row.private_port_start === null ? null : Number(row.private_port_start),
    private_port_end: row.private_port_end === null ? null : Number(row.private_port_end),
    public_ipv4: row.public_ipv4,
    public_port_start: Number(row.public_port_start),
    public_port_end: Number(row.public_port_end),
    protocol: PROTOCOL_NAMES[Number(row.protocol)],
    allocated_at: new Date(row.allocated_at).toISOString(),
    released_at: row.released_at ? new Date(row.released_at).toISOString() : null,
    certain_from: certainFrom.toISOString(),
    certain_until: certainUntil.toISOString(),
    exporter_id: row.exporter_id,
    exporter_config_id: Number(row.exporter_config_id),
    exporter_public_ipv4_start: row.exporter_public_ipv4_start,
    exporter_public_ipv4_end: row.exporter_public_ipv4_end,
    exporter_purpose_reference: row.exporter_purpose_reference,
    exporter_tuple_exclusivity_confirmed: Boolean(row.exporter_tuple_exclusivity_confirmed),
    exporter_authoritative_baseline_confirmed: Boolean(row.exporter_authoritative_baseline_confirmed),
    exporter_baseline_reference: row.exporter_baseline_reference,
    exporter_baseline_confirmed_by: row.exporter_baseline_confirmed_by === null
      ? null : Number(row.exporter_baseline_confirmed_by),
    exporter_baseline_confirmed_at: new Date(row.exporter_baseline_confirmed_at).toISOString(),
    exporter_collection_approved_by: row.exporter_collection_approved_by === null
      ? null : Number(row.exporter_collection_approved_by),
    exporter_collection_approved_at: new Date(row.exporter_collection_approved_at).toISOString(),
    exporter_epoch_created_at: new Date(row.exporter_epoch_created_at).toISOString(),
    exporter_epoch_retired_at: row.exporter_epoch_retired_at
      ? new Date(row.exporter_epoch_retired_at).toISOString() : null,
    exporter_last_device_recorded_at: row.exporter_last_device_recorded_at
      ? new Date(row.exporter_last_device_recorded_at).toISOString() : null,
    exporter_last_corrected_device_at: row.exporter_last_corrected_device_at
      ? new Date(row.exporter_last_corrected_device_at).toISOString() : null,
    exporter_coverage_horizon_at: row.exporter_coverage_horizon_at
      ? new Date(row.exporter_coverage_horizon_at).toISOString() : null,
    exporter_sequence_gap_events: Number(row.exporter_sequence_gap_events),
    exporter_sequence_missing_records: Number(row.exporter_sequence_missing_records),
    exporter_out_of_order_events: Number(row.exporter_out_of_order_events),
    exporter_reported_lost_records: Number(row.exporter_reported_lost_records),
    exporter_incomplete_metadata_events: Number(row.exporter_incomplete_metadata_events),
    collector_api_token_id: Number(row.collector_api_token_id),
    exporter_boot_id: row.exporter_boot_id,
    nat_instance_id: row.nat_instance_id,
    nat_pool_id: row.nat_pool_id,
    nat_realm: row.nat_realm,
    allocation_event_id: row.allocation_event_id,
    allocation_event_integrity_hash: row.allocation_event_integrity_hash,
    allocation_sequence_number: Number(row.allocation_sequence_number),
    allocation_sequence_status: row.allocation_sequence_status,
    allocation_device_recorded_at: new Date(row.allocation_device_recorded_at).toISOString(),
    allocation_received_at: new Date(row.allocation_received_at).toISOString(),
    release_event_id: row.release_event_id || null,
    release_event_integrity_hash: row.release_event_integrity_hash || null,
    release_sequence_number: row.release_sequence_number === null ? null : Number(row.release_sequence_number),
    release_sequence_status: row.release_sequence_status || null,
    release_device_recorded_at: row.release_device_recorded_at
      ? new Date(row.release_device_recorded_at).toISOString() : null,
    release_received_at: row.release_received_at ? new Date(row.release_received_at).toISOString() : null,
    allocation_clock_offset_ms: row.allocation_clock_offset_ms === null ? null : Number(row.allocation_clock_offset_ms),
    allocation_clock_uncertainty_ms: row.allocation_clock_uncertainty_ms === null ? null : Number(row.allocation_clock_uncertainty_ms),
    allocation_records_lost_before: row.allocation_records_lost_before === null ? null : Number(row.allocation_records_lost_before),
    release_clock_offset_ms: row.release_clock_offset_ms === null ? null : Number(row.release_clock_offset_ms),
    release_clock_uncertainty_ms: row.release_clock_uncertainty_ms === null ? null : Number(row.release_clock_uncertainty_ms),
    release_records_lost_before: row.release_records_lost_before === null ? null : Number(row.release_records_lost_before),
    access_session_state: row.access_session_event_type === 'stop' ? 'ended' : 'active',
    access_session_last_accounting_at: row.access_session_last_accounting_at
      ? new Date(row.access_session_last_accounting_at).toISOString() : null,
    access_session_last_accounting_received_at: row.access_session_last_accounting_received_at
      ? new Date(row.access_session_last_accounting_received_at).toISOString() : null,
    access_session_stop_evidence_id: row.access_session_stop_evidence_id === null
      || row.access_session_stop_evidence_id === undefined
      ? null : Number(row.access_session_stop_evidence_id),
    access_session_stop_event_at: row.access_session_stop_event_at
      ? new Date(row.access_session_stop_event_at).toISOString() : null,
    access_session_stop_observed_at: row.access_session_stop_observed_at
      ? new Date(row.access_session_stop_observed_at).toISOString() : null,
    access_session_stop_integrity_hash: row.access_session_stop_integrity_hash || null,
    integrity_hash: row.integrity_hash,
  };
}

async function pinCaseEvidence(organizationId, requestId, actorId, lookup, {
  evidenceType, bindingId = null, connectionLogId = null,
  sourceIntegrityHash, evidenceSnapshot,
}) {
  const snapshotJson = canonicalJson(evidenceSnapshot);
  const evidenceHash = crypto.createHash('sha256').update(snapshotJson).digest('hex');
  const queryKey = crypto.createHash('sha256').update(canonicalJson({
    organization_id: organizationId,
    gov_data_request_id: requestId,
    evidence_type: evidenceType,
    public_ipv4: lookup.public_ipv4,
    public_port: lookup.public_port,
    protocol: lookup.protocol,
    observed_at: lookup.observed_at.toISOString(),
  })).digest('hex');
  await db.query(
    `INSERT INTO ip_attribution_case_evidence
      (organization_id, gov_data_request_id, evidence_type, binding_id,
       connection_log_id, source_integrity_hash, evidence_snapshot,
       evidence_hash, query_key,
       public_ipv4, public_port, protocol, observed_at, pinned_by, pinned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE id = id`,
    [organizationId, requestId, evidenceType, bindingId, connectionLogId,
      sourceIntegrityHash, snapshotJson, evidenceHash, queryKey,
      lookup.public_ipv4, lookup.public_port, lookup.protocol, lookup.observed_at,
      actorId || null],
  );
  return evidenceHash;
}

function directEvidenceChainHash(organizationId, row) {
  return crypto.createHash('sha256').update(canonicalJson({
    organization_id: organizationId,
    connection_log_id: Number(row.connection_log_id),
    assignment_evidence_id: Number(row.assignment_evidence_id),
    assignment_evidence_integrity_hash: row.assignment_evidence_integrity_hash,
    closure_evidence_id: row.closure_evidence_id === null
      || row.closure_evidence_id === undefined ? null : Number(row.closure_evidence_id),
    closure_evidence_integrity_hash: row.closure_evidence_integrity_hash || null,
  })).digest('hex');
}

async function findDirectAssignments(organizationId, lookup) {
  const liveness = Math.min(Math.max(
    Number.parseInt(process.env.RADIUS_SESSION_LIVENESS_MINUTES || '60', 10) || 60,
    1,
  ), 1440);
  const [rows] = await db.query(
    `SELECT cl.id AS connection_log_id, cl.client_id, cl.contract_id, cl.username,
            COALESCE(cl.acct_session_id, cl.session_id) AS radius_session_id,
            cl.session_instance_id, COALESCE(cl.framed_ip, cl.ip_address) AS public_ipv4,
            assignment_evidence.id AS assignment_evidence_id,
            assignment_evidence.event_at AS assigned_at,
            assignment_evidence.event_at AS assignment_evidence_event_at,
            assignment_evidence.observed_at AS assignment_evidence_received_at,
            assignment_evidence.integrity_hash AS assignment_evidence_integrity_hash,
            closure_evidence.id AS closure_evidence_id,
            closure_evidence.event_at AS released_at,
            closure_evidence.observed_at AS closure_evidence_received_at,
            closure_evidence.integrity_hash AS closure_evidence_integrity_hash,
            cl.last_accounting_at, cl.last_accounting_received_at,
            client_row.name AS client_name
       FROM connection_logs cl
       JOIN radius_accounting_events assignment_evidence
         ON assignment_evidence.organization_id = cl.organization_id
        AND assignment_evidence.session_instance_id = cl.session_instance_id
        AND assignment_evidence.id = (
          SELECT assignment_pick.id FROM radius_accounting_events assignment_pick
           WHERE assignment_pick.organization_id = cl.organization_id
             AND assignment_pick.session_instance_id = cl.session_instance_id
             AND assignment_pick.framed_ip = ?
             AND assignment_pick.event_at <= ?
             AND assignment_pick.observed_at <= ?
           ORDER BY GREATEST(assignment_pick.event_at, assignment_pick.observed_at) ASC,
                    assignment_pick.id ASC LIMIT 1
        )
       LEFT JOIN radius_accounting_events closure_evidence
         ON cl.event_type = 'stop'
        AND closure_evidence.organization_id = cl.organization_id
        AND closure_evidence.session_instance_id = cl.session_instance_id
        AND closure_evidence.id = (
          SELECT closure_pick.id FROM radius_accounting_events closure_pick
           WHERE closure_pick.organization_id = cl.organization_id
             AND closure_pick.session_instance_id = cl.session_instance_id
             AND closure_pick.status_type = 'stop'
             AND closure_pick.framed_ip = ?
           ORDER BY closure_pick.event_at DESC, closure_pick.id DESC LIMIT 1
        )
       LEFT JOIN clients client_row ON client_row.id = cl.client_id
        AND client_row.organization_id = cl.organization_id
      WHERE cl.organization_id = ?
        AND COALESCE(cl.framed_ip, cl.ip_address) = ?
        AND cl.attribution_evidence_complete = 1
        AND cl.client_id IS NOT NULL AND cl.client_id <> 0
        AND cl.contract_id IS NOT NULL AND cl.contract_id <> 0
        AND cl.session_instance_id IS NOT NULL
        AND cl.username IS NOT NULL
        AND COALESCE(cl.acct_session_id, cl.session_id) IS NOT NULL
        AND (
          (cl.event_type = 'stop' AND closure_evidence.event_at > ?
             AND closure_evidence.observed_at > ?)
          OR
          (cl.event_type <> 'stop' AND cl.last_accounting_received_at IS NOT NULL
             AND cl.last_accounting_received_at >= DATE_SUB(NOW(3), INTERVAL ${liveness} MINUTE)
             AND cl.last_accounting_at >= ?
             AND cl.last_accounting_received_at >= ?)
        )
      ORDER BY GREATEST(assignment_evidence.event_at, assignment_evidence.observed_at) DESC,
               cl.id DESC`,
    [lookup.public_ipv4, lookup.observed_at, lookup.observed_at, lookup.public_ipv4,
      organizationId, lookup.public_ipv4,
      lookup.observed_at, lookup.observed_at, lookup.observed_at,
      lookup.observed_at],
  );
  return rows;
}

function directAttribution(organizationId, row) {
  const certainFrom = new Date(Math.max(
    new Date(row.assignment_evidence_event_at).getTime(),
    new Date(row.assignment_evidence_received_at).getTime(),
  ));
  const certainUntil = row.released_at
    ? new Date(Math.min(new Date(row.released_at).getTime(),
      new Date(row.closure_evidence_received_at).getTime()))
    : new Date(Math.min(new Date(row.last_accounting_at).getTime(),
      new Date(row.last_accounting_received_at).getTime()));
  return {
    connection_log_id: Number(row.connection_log_id),
    client_id: Number(row.client_id),
    client_name: row.client_name || null,
    contract_id: Number(row.contract_id),
    username: row.username,
    radius_session_id: row.radius_session_id,
    session_instance_id: row.session_instance_id,
    public_ipv4: row.public_ipv4,
    assigned_at: new Date(row.assigned_at).toISOString(),
    released_at: row.released_at ? new Date(row.released_at).toISOString() : null,
    certain_from: certainFrom.toISOString(),
    certain_until: certainUntil.toISOString(),
    assignment_evidence_id: Number(row.assignment_evidence_id),
    assignment_evidence_event_at: new Date(row.assignment_evidence_event_at).toISOString(),
    assignment_evidence_received_at: new Date(row.assignment_evidence_received_at).toISOString(),
    assignment_evidence_integrity_hash: row.assignment_evidence_integrity_hash,
    closure_evidence_id: row.closure_evidence_id === null
      || row.closure_evidence_id === undefined ? null : Number(row.closure_evidence_id),
    closure_evidence_event_at: row.released_at
      ? new Date(row.released_at).toISOString() : null,
    closure_evidence_received_at: row.closure_evidence_received_at
      ? new Date(row.closure_evidence_received_at).toISOString() : null,
    closure_evidence_integrity_hash: row.closure_evidence_integrity_hash || null,
    accounting_received_at: row.last_accounting_received_at
      ? new Date(row.last_accounting_received_at).toISOString() : null,
    last_accounting_event_at: row.last_accounting_at
      ? new Date(row.last_accounting_at).toISOString() : null,
    evidence_hash: directEvidenceChainHash(organizationId, row),
  };
}

async function lookupAttribution(organizationId, body, { actorId = null, pin = true } = {}) {
  positiveInteger(organizationId, 'organization_id');
  const lookup = normalizeLookup(body);
  const authorizedCase = await loadAuthorizedCase(organizationId, lookup);
  // The approved case tuple selects exactly one evidence path. A tuple-less
  // case is direct-public; a complete port/protocol tuple is CGNAT.
  const directRowsPromise = lookup.public_port === null
    ? findDirectAssignments(organizationId, lookup)
    : Promise.resolve([]);
  let rows = [];
  if (lookup.public_port !== null) {
    const liveness = Math.min(Math.max(
      Number.parseInt(process.env.RADIUS_SESSION_LIVENESS_MINUTES || '60', 10) || 60,
      1,
    ), 1440);
    [rows] = await db.query(
      `SELECT binding.*, client_row.name AS client_name,
              allocation_event.integrity_hash AS allocation_event_integrity_hash,
              release_event.integrity_hash AS release_event_integrity_hash,
              access_session.event_type AS access_session_event_type,
              access_session.last_accounting_at AS access_session_last_accounting_at,
              access_session.last_accounting_received_at AS access_session_last_accounting_received_at,
              access_stop_evidence.id AS access_session_stop_evidence_id,
              access_stop_evidence.event_at AS access_session_stop_event_at,
              access_stop_evidence.observed_at AS access_session_stop_observed_at,
              access_stop_evidence.integrity_hash AS access_session_stop_integrity_hash,
              evidence_config.public_ipv4_start AS exporter_public_ipv4_start,
              evidence_config.public_ipv4_end AS exporter_public_ipv4_end,
              evidence_config.purpose_reference AS exporter_purpose_reference,
              evidence_config.tuple_exclusivity_confirmed AS exporter_tuple_exclusivity_confirmed,
              evidence_config.authoritative_baseline_confirmed AS exporter_authoritative_baseline_confirmed,
              evidence_config.baseline_reference AS exporter_baseline_reference,
              evidence_config.baseline_confirmed_by AS exporter_baseline_confirmed_by,
              evidence_config.baseline_confirmed_at AS exporter_baseline_confirmed_at,
              evidence_config.collection_approved_by AS exporter_collection_approved_by,
              evidence_config.collection_approved_at AS exporter_collection_approved_at,
              evidence_config.created_at AS exporter_epoch_created_at,
              evidence_config.retired_at AS exporter_epoch_retired_at,
              evidence_config.last_device_recorded_at AS exporter_last_device_recorded_at,
              evidence_config.last_corrected_device_at AS exporter_last_corrected_device_at,
              evidence_config.coverage_horizon_at AS exporter_coverage_horizon_at,
              evidence_config.sequence_gap_events AS exporter_sequence_gap_events,
              evidence_config.sequence_missing_records AS exporter_sequence_missing_records,
              evidence_config.out_of_order_events AS exporter_out_of_order_events,
              evidence_config.reported_lost_records AS exporter_reported_lost_records,
              evidence_config.incomplete_metadata_events AS exporter_incomplete_metadata_events
         FROM cgnat_attribution_bindings binding
         JOIN cgnat_exporter_configs evidence_config
           ON evidence_config.id = binding.exporter_config_id
          AND evidence_config.organization_id = binding.organization_id
         JOIN connection_logs access_session
           ON access_session.id = binding.connection_log_id
          AND access_session.organization_id = binding.organization_id
          AND access_session.session_instance_id = binding.session_instance_id
         JOIN radius_accounting_events radius_anchor
          ON radius_anchor.id = binding.radius_evidence_id
          AND radius_anchor.event_at = binding.radius_evidence_event_at
          AND radius_anchor.observed_at = binding.radius_evidence_observed_at
          AND radius_anchor.organization_id = binding.organization_id
          AND radius_anchor.session_instance_id = binding.session_instance_id
          AND radius_anchor.framed_ip = binding.private_ipv4
          AND radius_anchor.integrity_hash = binding.radius_evidence_integrity_hash
          AND radius_anchor.event_at <= TIMESTAMPADD(MICROSECOND,
            -1000 * COALESCE(binding.allocation_clock_uncertainty_ms, ${MAX_CLOCK_UNCERTAINTY_MS}),
            binding.allocated_at)
          AND radius_anchor.observed_at <= TIMESTAMPADD(MICROSECOND,
            -1000 * COALESCE(binding.allocation_clock_uncertainty_ms, ${MAX_CLOCK_UNCERTAINTY_MS}),
            binding.allocated_at)
         JOIN cgnat_binding_events allocation_event
           ON allocation_event.binding_id = binding.id
          AND allocation_event.organization_id = binding.organization_id
          AND allocation_event.event_type = 'allocate'
          AND allocation_event.event_id = binding.allocation_event_id
         LEFT JOIN cgnat_binding_events release_event
           ON release_event.binding_id = binding.id
          AND release_event.organization_id = binding.organization_id
          AND release_event.event_type = 'release'
          AND release_event.event_id = binding.release_event_id
         LEFT JOIN radius_accounting_events access_stop_evidence
           ON access_session.event_type = 'stop'
          AND access_stop_evidence.organization_id = access_session.organization_id
          AND access_stop_evidence.session_instance_id = access_session.session_instance_id
          AND access_stop_evidence.id = (
            SELECT stop_pick.id FROM radius_accounting_events stop_pick
             WHERE stop_pick.organization_id = access_session.organization_id
               AND stop_pick.session_instance_id = access_session.session_instance_id
               AND stop_pick.status_type = 'stop'
               AND stop_pick.framed_ip = binding.private_ipv4
             ORDER BY stop_pick.event_at DESC, stop_pick.id DESC LIMIT 1
          )
         LEFT JOIN clients client_row ON client_row.id = binding.client_id
          AND client_row.organization_id = binding.organization_id
        WHERE binding.organization_id = ? AND binding.public_ipv4 = ?
          AND access_session.attribution_evidence_complete = 1
          AND binding.protocol = ? AND binding.public_port_start <= ?
          AND binding.public_port_end >= ?
          AND TIMESTAMPADD(MICROSECOND,
            -1000 * COALESCE(binding.allocation_clock_uncertainty_ms, ?),
            binding.allocated_at) <= ?
          AND (binding.released_at IS NULL OR TIMESTAMPADD(MICROSECOND,
            1000 * COALESCE(binding.release_clock_uncertainty_ms, ?),
            binding.released_at) > ?)
          AND (
            (access_session.event_type = 'stop' AND access_stop_evidence.event_at > ?
              AND access_stop_evidence.observed_at > ?)
            OR
            (access_session.event_type <> 'stop'
              AND access_session.last_accounting_received_at >= DATE_SUB(NOW(3), INTERVAL ${liveness} MINUTE)
              AND access_session.last_accounting_at >= ?
              AND access_session.last_accounting_received_at >= ?)
          )
        ORDER BY binding.allocated_at DESC, binding.id DESC`,
      [organizationId, lookup.public_ipv4, lookup.protocol,
        lookup.public_port, lookup.public_port, MAX_CLOCK_UNCERTAINTY_MS,
        lookup.observed_at, MAX_CLOCK_UNCERTAINTY_MS, lookup.observed_at,
        lookup.observed_at, lookup.observed_at, lookup.observed_at,
        lookup.observed_at],
    );
  }
  const directRows = await directRowsPromise;
  const candidates = rows;
  const query = {
    public_ipv4: lookup.public_ipv4,
    public_port: lookup.public_port,
    protocol: lookup.protocol === null ? null : PROTOCOL_NAMES[lookup.protocol],
    observed_at: lookup.observed_at.toISOString(),
  };
  const base = { gov_data_request_id: lookup.gov_data_request_id, query };
  base.authorization = {
    authority_name: authorizedCase.authority_name,
    authority_ref: authorizedCase.authority_ref,
    legal_reviewed_at: authorizedCase.legal_reviewed_at
      ? new Date(authorizedCase.legal_reviewed_at).toISOString() : null,
    legal_reviewed_by: authorizedCase.legal_reviewed_by === null
      || authorizedCase.legal_reviewed_by === undefined
      ? null : Number(authorizedCase.legal_reviewed_by),
    legal_basis_hash: crypto.createHash('sha256')
      .update(String(authorizedCase.legal_basis).trim()).digest('hex'),
    request_row_hash: authorizedCase.row_hash,
  };
  const totalCandidates = candidates.length + directRows.length;
  if (totalCandidates === 0) {
    return { ...base, status: 'unavailable', reason: lookup.public_port === null ? 'no_direct_assignment' : 'no_attribution_evidence', candidate_count: 0, attributionMethod: null };
  }
  if (totalCandidates !== 1) {
    return { ...base, status: 'ambiguous', reason: 'multiple_attribution_candidates', candidate_count: totalCandidates, attributionMethod: null };
  }
  if (directRows.length === 1) {
    const attribution = directAttribution(organizationId, directRows[0]);
    assertAuthorizedCaseSubject(authorizedCase, attribution);
    let evidenceSnapshotHash = null;
    if (pin) evidenceSnapshotHash = await pinCaseEvidence(organizationId, lookup.gov_data_request_id, actorId, lookup, {
      evidenceType: 'direct_public_assignment',
      connectionLogId: attribution.connection_log_id,
      sourceIntegrityHash: attribution.evidence_hash,
      evidenceSnapshot: attribution,
    });
    return {
      ...base, status: 'matched', reason: null, candidate_count: 1,
      attributionMethod: 'direct_public_assignment', attribution,
      evidence_snapshot_hash: evidenceSnapshotHash,
    };
  }
  const row = candidates[0];
  if (!certainlyCoversInstant(row, lookup.observed_at)) {
    return { ...base, status: 'unavailable', reason: 'clock_boundary_uncertainty', candidate_count: 1, attributionMethod: null };
  }
  if (!Number(row.metadata_complete)
      || !['initial', 'contiguous'].includes(row.allocation_sequence_status)
      || Number(row.allocation_records_lost_before) > 0
      || (row.released_at && (!['initial', 'contiguous'].includes(row.release_sequence_status)
        || Number(row.release_records_lost_before) > 0))) {
    return { ...base, status: 'unavailable', reason: 'incomplete_exporter_evidence', candidate_count: 1, attributionMethod: null };
  }
  const [[candidateExporter]] = await db.query(
    `SELECT config.id,
       (config.purpose_reference IS NOT NULL AND TRIM(config.purpose_reference) <> ''
        AND config.collection_approved_at IS NOT NULL
        AND config.authoritative_baseline_confirmed = 1
        AND config.baseline_confirmed_at IS NOT NULL
        AND config.baseline_reference IS NOT NULL AND TRIM(config.baseline_reference) <> ''
        AND config.collection_approved_at <= TIMESTAMPADD(MICROSECOND,
          -1000 * COALESCE(?, ?), ?)
        AND config.baseline_confirmed_at <= TIMESTAMPADD(MICROSECOND,
          -1000 * COALESCE(?, ?), ?)
        AND (config.retired_at IS NULL OR config.retired_at > ?)
        AND config.tuple_exclusivity_confirmed = 1
        AND config.last_binding_received_at IS NOT NULL
        AND config.coverage_horizon_at >= ?
        AND config.sequence_gap_events = 0 AND config.sequence_missing_records = 0
        AND config.out_of_order_events = 0 AND config.reported_lost_records = 0
        AND config.incomplete_metadata_events = 0) AS healthy
      FROM cgnat_exporter_configs config
      WHERE config.id = ? AND config.organization_id = ? LIMIT 1`,
    [row.allocation_clock_uncertainty_ms, MAX_CLOCK_UNCERTAINTY_MS, row.allocated_at,
      row.allocation_clock_uncertainty_ms, MAX_CLOCK_UNCERTAINTY_MS, row.allocated_at,
      lookup.observed_at, lookup.observed_at,
      row.exporter_config_id, organizationId],
  );
  if (!candidateExporter || !Number(candidateExporter.healthy)) {
    return { ...base, status: 'unavailable', reason: 'candidate_exporter_evidence_incomplete', candidate_count: 1, attributionMethod: null };
  }
  const [[coverage]] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(
              config.purpose_reference IS NOT NULL
              AND TRIM(config.purpose_reference) <> ''
              AND config.collection_approved_at IS NOT NULL
              AND config.authoritative_baseline_confirmed = 1
              AND config.baseline_confirmed_at IS NOT NULL
              AND config.baseline_reference IS NOT NULL AND TRIM(config.baseline_reference) <> ''
              AND config.collection_approved_at <= ?
              AND config.baseline_confirmed_at <= ?
              AND (config.retired_at IS NULL OR config.retired_at > ?)
              AND config.tuple_exclusivity_confirmed = 1
              AND config.last_binding_received_at IS NOT NULL
              AND config.coverage_horizon_at >= ?
              AND config.sequence_gap_events = 0
              AND config.sequence_missing_records = 0
              AND config.out_of_order_events = 0
              AND config.reported_lost_records = 0
              AND config.incomplete_metadata_events = 0
            ), 0) AS healthy
       FROM cgnat_exporter_configs config
      WHERE config.organization_id = ?
        AND config.collection_approved_at <= ?
        AND config.baseline_confirmed_at <= ?
        AND (config.retired_at IS NULL OR config.retired_at > ?)
        AND INET_ATON(?) BETWEEN INET_ATON(config.public_ipv4_start)
                            AND INET_ATON(config.public_ipv4_end)`,
    [lookup.observed_at, lookup.observed_at, lookup.observed_at, lookup.observed_at,
      organizationId, lookup.observed_at, lookup.observed_at,
      lookup.observed_at, lookup.public_ipv4],
  );
  if (Number(coverage?.total || 0) !== 1 || Number(coverage?.healthy || 0) !== 1) {
    return { ...base, status: 'unavailable', reason: 'incomplete_exporter_pool_coverage', candidate_count: 1, attributionMethod: null };
  }
  const attribution = publicAttribution(row);
  assertAuthorizedCaseSubject(authorizedCase, attribution);
  let evidenceSnapshotHash = null;
  if (pin) evidenceSnapshotHash = await pinCaseEvidence(organizationId, lookup.gov_data_request_id, actorId, lookup, {
    evidenceType: 'cgnat_binding', bindingId: Number(row.id),
    connectionLogId: Number(row.connection_log_id),
    sourceIntegrityHash: row.integrity_hash, evidenceSnapshot: attribution,
  });
  return {
    ...base,
    status: 'matched',
    reason: null,
    candidate_count: 1,
    attributionMethod: 'cgnat_binding',
    attribution,
    evidence_snapshot_hash: evidenceSnapshotHash,
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let string = String(value);
  if (/^[\t\r\n =+\-@]/.test(string)) string = `'${string}`;
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function attributionToCsv(result) {
  const columns = [
    'gov_data_request_id', 'status', 'reason', 'candidate_count',
    'attribution_method', 'evidence_snapshot_hash',
    'authority_name', 'authority_ref', 'legal_reviewed_at', 'legal_reviewed_by',
    'legal_basis_hash', 'request_row_hash',
    'public_ipv4', 'public_port', 'protocol', 'observed_at',
    'connection_log_id', 'binding_id', 'binding_type', 'client_id',
    'client_name', 'contract_id', 'username', 'radius_session_id',
    'session_instance_id', 'private_ipv4', 'private_port_start', 'private_port_end',
    'public_port_start', 'public_port_end', 'assigned_at', 'allocated_at', 'released_at',
    'certain_from', 'certain_until', 'last_accounting_event_at',
    'accounting_received_at', 'assignment_evidence_id', 'assignment_evidence_event_at',
    'assignment_evidence_received_at', 'assignment_evidence_integrity_hash',
    'closure_evidence_id', 'closure_evidence_event_at', 'closure_evidence_received_at',
    'closure_evidence_integrity_hash', 'radius_evidence_id',
    'radius_evidence_event_at', 'radius_evidence_observed_at',
    'radius_evidence_integrity_hash',
    'exporter_id', 'exporter_config_id', 'exporter_public_ipv4_start',
    'exporter_public_ipv4_end', 'exporter_purpose_reference',
    'exporter_tuple_exclusivity_confirmed',
    'exporter_authoritative_baseline_confirmed', 'exporter_baseline_reference',
    'exporter_baseline_confirmed_by', 'exporter_baseline_confirmed_at',
    'exporter_collection_approved_by', 'exporter_collection_approved_at',
    'exporter_epoch_created_at', 'exporter_epoch_retired_at',
    'exporter_last_device_recorded_at', 'exporter_last_corrected_device_at',
    'exporter_coverage_horizon_at',
    'exporter_sequence_gap_events', 'exporter_sequence_missing_records',
    'exporter_out_of_order_events', 'exporter_reported_lost_records',
    'exporter_incomplete_metadata_events',
    'collector_api_token_id', 'exporter_boot_id',
    'nat_instance_id', 'nat_pool_id', 'nat_realm',
    'allocation_event_id', 'allocation_event_integrity_hash',
    'allocation_sequence_number', 'allocation_sequence_status',
    'allocation_device_recorded_at', 'allocation_received_at',
    'allocation_clock_offset_ms', 'allocation_clock_uncertainty_ms',
    'allocation_records_lost_before', 'release_event_id',
    'release_event_integrity_hash', 'release_sequence_number',
    'release_sequence_status', 'release_device_recorded_at', 'release_received_at',
    'release_clock_offset_ms', 'release_clock_uncertainty_ms',
    'release_records_lost_before', 'access_session_state',
    'access_session_last_accounting_at', 'access_session_last_accounting_received_at',
    'access_session_stop_evidence_id', 'access_session_stop_event_at',
    'access_session_stop_observed_at',
    'access_session_stop_integrity_hash', 'evidence_hash', 'integrity_hash',
  ];
  const row = {
    gov_data_request_id: result.gov_data_request_id,
    status: result.status,
    reason: result.reason,
    candidate_count: result.candidate_count,
    attribution_method: result.attributionMethod,
    evidence_snapshot_hash: result.evidence_snapshot_hash,
    ...(result.authorization || {}),
    ...result.query,
    ...(result.attribution || {}),
  };
  return `${columns.join(',')}\r\n${columns.map(column => csvEscape(row[column])).join(',')}\r\n`;
}

function normalizeExporterConfig(body) {
  rejectUnknownFields(body, EXPORTER_FIELDS, 'body');
  const isRequired = body.is_required === undefined ? true : body.is_required;
  const enabled = body.enabled === undefined ? false : body.enabled;
  const tupleExclusivityConfirmed = body.tuple_exclusivity_confirmed === undefined
    ? false : body.tuple_exclusivity_confirmed;
  const baselineConfirmed = body.authoritative_baseline_confirmed === undefined
    ? false : body.authoritative_baseline_confirmed;
  if (typeof isRequired !== 'boolean' || typeof enabled !== 'boolean'
      || typeof tupleExclusivityConfirmed !== 'boolean'
      || typeof baselineConfirmed !== 'boolean') {
    throw new ValidationError('Invalid exporter flags', [{ field: 'is_required', message: 'is_required and enabled must be booleans' }]);
  }
  if (enabled && !isRequired) {
    throw new ValidationError('Enabled CGNAT exporter configurations must be required for coverage readiness');
  }
  const purposeReference = optionalString(body.purpose_reference, 'purpose_reference', 500);
  const baselineReference = optionalString(body.baseline_reference, 'baseline_reference', 500);
  if (enabled && !String(purposeReference || '').trim()) {
    throw new ValidationError('purpose_reference is required to enable CGNAT attribution collection');
  }
  if (enabled && !tupleExclusivityConfirmed) {
    throw new ValidationError('tuple_exclusivity_confirmed must be true; endpoint-dependent NAT cannot be attributed without prohibited destination fields');
  }
  if (enabled && (!baselineConfirmed || !String(baselineReference || '').trim())) {
    throw new ValidationError('An authoritative baseline confirmation and reference are required to enable CGNAT attribution collection');
  }
  return {
    exporter_id: requiredAsciiString(body.exporter_id, 'exporter_id', 191),
    exporter_nas_id: positiveInteger(body.exporter_nas_id, 'exporter_nas_id', { nullable: true }),
    exporter_ip: ipv4(body.exporter_ip, 'exporter_ip', { nullable: true }),
    nat_instance_id: requiredAsciiString(body.nat_instance_id, 'nat_instance_id', 191),
    nat_pool_id: requiredAsciiString(body.nat_pool_id, 'nat_pool_id', 191),
    nat_pool_record_id: positiveInteger(body.nat_pool_record_id, 'nat_pool_record_id'),
    collector_api_token_id: positiveInteger(body.collector_api_token_id, 'collector_api_token_id'),
    nat_realm: requiredAsciiString(body.nat_realm, 'nat_realm', 191),
    purpose_reference: purposeReference,
    tuple_exclusivity_confirmed: tupleExclusivityConfirmed,
    authoritative_baseline_confirmed: baselineConfirmed,
    baseline_reference: baselineReference,
    is_required: isRequired,
    enabled,
  };
}

function publicExporterConfig(row) {
  if (!row) return row;
  const integerFields = [
    'id', 'exporter_nas_id', 'nat_pool_record_id',
    'collector_api_token_id', 'recovery_collector_api_token_id',
    'recovery_approved_by', 'baseline_confirmed_by', 'collection_approved_by',
    'retired_by', 'last_sequence_number', 'sequence_gap_events',
    'sequence_missing_records', 'out_of_order_events', 'reported_lost_records',
    'incomplete_metadata_events',
  ];
  const dateFields = [
    'recovery_approved_at', 'baseline_confirmed_at', 'collection_approved_at', 'retired_at',
    'last_binding_received_at', 'last_device_recorded_at',
    'last_corrected_device_at', 'coverage_horizon_at', 'created_at', 'updated_at',
  ];
  const result = { ...row };
  delete result.organization_id;
  for (const field of integerFields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      result[field] = row[field] === null || row[field] === undefined
        ? null : Number(row[field]);
    }
  }
  for (const field of dateFields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      result[field] = row[field] ? new Date(row[field]).toISOString() : null;
    }
  }
  result.tuple_exclusivity_confirmed = Boolean(row.tuple_exclusivity_confirmed);
  result.authoritative_baseline_confirmed = Boolean(row.authoritative_baseline_confirmed);
  result.is_required = Boolean(row.is_required);
  result.enabled = Boolean(row.enabled);
  return result;
}

async function collectorTokenIsValid(organizationId, collectorApiTokenId) {
  return db.withPrimaryContext(async () => {
    const [tokens] = await db.query(
      `SELECT id, user_id FROM api_tokens WHERE id = ? AND organization_id = ?
        AND deleted_at IS NULL AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND JSON_LENGTH(scopes) = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(scopes, '$[0]')) = 'cgnat_attribution:ingest'
        LIMIT 1`,
      [collectorApiTokenId, organizationId],
    );
    if (tokens.length !== 1) return false;
    const token = tokens[0];
    if (!await resolveOrgPrincipal({ id: token.user_id }, organizationId, { allowOperator: false })) {
      return false;
    }
    const permissions = await User.getPermissions(token.user_id, organizationId);
    return permissions.includes('cgnat_attribution.ingest');
  });
}

async function saveExporterConfig(organizationId, body, { approvalActorId = null } = {}) {
  positiveInteger(organizationId, 'organization_id');
  const config = normalizeExporterConfig(body);
  if (config.enabled || (!config.enabled && !config.is_required)) {
    positiveInteger(approvalActorId, 'approval_actor_id');
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      'SELECT id FROM organizations WHERE id = ? FOR UPDATE', [organizationId],
    );
    const [existingRows] = await connection.execute(
      `SELECT * FROM cgnat_exporter_configs WHERE organization_id = ?
        AND exporter_id = ? AND nat_instance_id = ? AND nat_pool_id = ? AND nat_realm = ?
        LIMIT 1 FOR UPDATE`,
      [organizationId, config.exporter_id, config.nat_instance_id,
        config.nat_pool_id, config.nat_realm],
    );
    const existing = existingRows[0] || null;
    const retirementSnapshot = existing && !config.enabled && !config.is_required
      ? existing : null;
    if (retirementSnapshot) {
      config.exporter_nas_id = retirementSnapshot.exporter_nas_id
        ? Number(retirementSnapshot.exporter_nas_id) : null;
      config.exporter_ip = retirementSnapshot.exporter_ip || null;
      config.nat_pool_record_id = Number(retirementSnapshot.nat_pool_record_id);
      config.collector_api_token_id = Number(retirementSnapshot.collector_api_token_id);
      config.purpose_reference = retirementSnapshot.purpose_reference;
      config.tuple_exclusivity_confirmed = Boolean(retirementSnapshot.tuple_exclusivity_confirmed);
      config.authoritative_baseline_confirmed = Boolean(retirementSnapshot.authoritative_baseline_confirmed);
      config.baseline_reference = retirementSnapshot.baseline_reference;
    } else {
      const tokenValid = await collectorTokenIsValid(
        organizationId, config.collector_api_token_id,
      );
      if (!tokenValid) {
        throw new ValidationError('collector_api_token_id must identify one active same-organization exact-scope CGNAT ingest token');
      }
    }
    if (!retirementSnapshot && (config.exporter_nas_id || config.exporter_ip)) {
      const conditions = ['organization_id = ?', "status = 'active'", 'deleted_at IS NULL'];
      const params = [organizationId];
      if (config.exporter_nas_id) { conditions.push('id = ?'); params.push(config.exporter_nas_id); }
      if (config.exporter_ip) { conditions.push('ip_address = ?'); params.push(config.exporter_ip); }
      const [rows] = await connection.execute(
        `SELECT id, ip_address FROM nas WHERE ${conditions.join(' AND ')} LIMIT 2`, params,
      );
      if (rows.length !== 1) throw new ValidationError('Exporter NAS does not belong to this organization');
      config.exporter_nas_id = Number(rows[0].id);
      config.exporter_ip = rows[0].ip_address;
    }
    const [poolRows] = retirementSnapshot ? [[{
      id: retirementSnapshot.nat_pool_record_id,
      external_ip_start: retirementSnapshot.public_ipv4_start,
      external_ip_end: retirementSnapshot.public_ipv4_end,
    }]] : await connection.execute(
      `SELECT id, external_ip_start, external_ip_end FROM nat_pools
        WHERE id = ? AND organization_id = ? AND nat_type IN ('cgnat','pat')
          AND status = 'active' AND deleted_at IS NULL LIMIT 2`,
      [config.nat_pool_record_id, organizationId],
    );
    if (poolRows.length !== 1) throw new ValidationError('nat_pool_record_id must identify one active tenant CGNAT/PAT pool');
    const poolStart = publicIpv4(poolRows[0].external_ip_start, 'nat_pool.external_ip_start');
    const poolEnd = publicIpv4(poolRows[0].external_ip_end, 'nat_pool.external_ip_end');
    if (ipv4Number(poolEnd) < ipv4Number(poolStart)) throw new ValidationError('NAT pool external IPv4 range is reversed');

    const [tokenOwners] = await connection.execute(
      `SELECT id FROM cgnat_exporter_configs
        WHERE organization_id = ? AND id <> ?
          AND (collector_api_token_id = ? OR recovery_collector_api_token_id = ?)
        LIMIT 1 FOR UPDATE`,
      [organizationId, Number(existing?.id || 0),
        config.collector_api_token_id, config.collector_api_token_id],
    );
    if (tokenOwners.length) {
      throw new ConflictError('A CGNAT collector token may be bound to only one exporter evidence epoch');
    }

    const [eventCountRows] = existing ? await connection.execute(
      'SELECT COUNT(*) AS total FROM cgnat_binding_events WHERE organization_id = ? AND exporter_config_id = ?',
      [organizationId, Number(existing.id)],
    ) : [[{ total: 0 }]];
    const hasEvidence = Number(eventCountRows[0]?.total || 0) > 0;

    if (existing?.retired_at && config.enabled) {
      throw new ConflictError('A retired exporter evidence epoch cannot be re-enabled; register a versioned exporter identity');
    }
    if (existing && hasEvidence) {
      const immutable = [
        ['exporter_nas_id', config.exporter_nas_id], ['exporter_ip', config.exporter_ip],
        ['nat_pool_record_id', config.nat_pool_record_id],
        ['collector_api_token_id', config.collector_api_token_id],
        ['public_ipv4_start', poolStart], ['public_ipv4_end', poolEnd],
        ['purpose_reference', config.purpose_reference],
        ['tuple_exclusivity_confirmed', config.tuple_exclusivity_confirmed ? 1 : 0],
        ['authoritative_baseline_confirmed', config.authoritative_baseline_confirmed ? 1 : 0],
        ['baseline_reference', config.baseline_reference],
      ];
      const changed = immutable.filter(([field, value]) => String(existing[field] ?? '') !== String(value ?? ''));
      if (changed.length) {
        throw new ConflictError('Exporter evidentiary fields are immutable after the first accepted event; register a versioned exporter identity');
      }
      if (config.enabled && !Number(existing.enabled)) {
        throw new ConflictError('A disabled evidence epoch cannot be re-enabled; register a versioned exporter identity');
      }
      if (!config.enabled && Number(existing.enabled) && config.is_required) {
        throw new ConflictError('Retiring an exporter evidence epoch requires enabled=false and is_required=false');
      }
      if (config.is_required && !Number(existing.is_required)) {
        throw new ConflictError('A retired/nonrequired evidence epoch cannot become required again');
      }
      if (!config.enabled && Number(existing.enabled)) {
        const [[open]] = await connection.execute(
          `SELECT COUNT(*) AS total FROM cgnat_attribution_bindings
            WHERE organization_id = ? AND exporter_config_id = ? AND released_at IS NULL`,
          [organizationId, Number(existing.id)],
        );
        if (Number(open?.total || 0) > 0) {
          throw new ConflictError('Close all active allocations before retiring an exporter evidence epoch');
        }
      }
      await connection.execute(
        `UPDATE cgnat_exporter_configs
            SET enabled = ?, is_required = ?,
                retired_at = CASE WHEN ? = 1 THEN COALESCE(retired_at, NOW(3)) ELSE retired_at END,
                retired_by = CASE WHEN ? = 1 THEN COALESCE(retired_by, ?) ELSE retired_by END,
                updated_at = NOW(3)
          WHERE id = ? AND organization_id = ?`,
        [config.enabled ? 1 : 0, config.is_required ? 1 : 0,
          !config.enabled && Number(existing.enabled) ? 1 : 0,
          !config.enabled && Number(existing.enabled) ? 1 : 0, approvalActorId,
          Number(existing.id), organizationId],
      );
    } else {
      const [overlaps] = await connection.execute(
        `SELECT id FROM cgnat_exporter_configs
          WHERE organization_id = ? AND id <> ? AND enabled = 1
            AND INET_ATON(public_ipv4_start) <= INET_ATON(?)
            AND INET_ATON(public_ipv4_end) >= INET_ATON(?) LIMIT 1 FOR UPDATE`,
        [organizationId, Number(existing?.id || 0), poolEnd, poolStart],
      );
      if (config.enabled && overlaps.length) {
        throw new ValidationError('Enabled CGNAT pool coverage overlaps another configured NAT pool');
      }
      if (existing) {
        await connection.execute(
          `UPDATE cgnat_exporter_configs SET exporter_nas_id = ?, exporter_ip = ?,
              nat_pool_record_id = ?, collector_api_token_id = ?, public_ipv4_start = ?,
              public_ipv4_end = ?, purpose_reference = ?, tuple_exclusivity_confirmed = ?,
              authoritative_baseline_confirmed = ?, baseline_reference = ?,
              baseline_confirmed_by = CASE WHEN ? = 1 THEN ? ELSE NULL END,
              baseline_confirmed_at = CASE WHEN ? = 1 THEN NOW(3) ELSE NULL END,
              collection_approved_by = CASE WHEN ? = 1 THEN ? ELSE NULL END,
              collection_approved_at = CASE WHEN ? = 1 THEN NOW(3) ELSE NULL END,
              is_required = ?, enabled = ?, updated_at = NOW(3)
            WHERE id = ? AND organization_id = ?`,
          [config.exporter_nas_id, config.exporter_ip, config.nat_pool_record_id,
            config.collector_api_token_id, poolStart, poolEnd, config.purpose_reference,
            config.tuple_exclusivity_confirmed ? 1 : 0,
            config.authoritative_baseline_confirmed ? 1 : 0, config.baseline_reference,
            config.enabled ? 1 : 0, approvalActorId, config.enabled ? 1 : 0,
            config.enabled ? 1 : 0, approvalActorId, config.enabled ? 1 : 0,
            config.is_required ? 1 : 0, config.enabled ? 1 : 0,
            Number(existing.id), organizationId],
        );
      } else {
        await connection.execute(
          `INSERT INTO cgnat_exporter_configs
            (organization_id, exporter_id, exporter_nas_id, exporter_ip,
             nat_instance_id, nat_pool_id, nat_pool_record_id, collector_api_token_id,
             public_ipv4_start, public_ipv4_end, nat_realm, purpose_reference,
             tuple_exclusivity_confirmed, authoritative_baseline_confirmed,
             baseline_reference, baseline_confirmed_by, baseline_confirmed_at,
             collection_approved_by, collection_approved_at, is_required, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   CASE WHEN ? = 1 THEN NOW(3) ELSE NULL END, ?,
                   CASE WHEN ? = 1 THEN NOW(3) ELSE NULL END, ?, ?)`,
          [organizationId, config.exporter_id, config.exporter_nas_id, config.exporter_ip,
            config.nat_instance_id, config.nat_pool_id, config.nat_pool_record_id,
            config.collector_api_token_id, poolStart, poolEnd, config.nat_realm,
            config.purpose_reference, config.tuple_exclusivity_confirmed ? 1 : 0,
            config.authoritative_baseline_confirmed ? 1 : 0, config.baseline_reference,
            config.enabled ? approvalActorId : null, config.enabled ? 1 : 0,
            config.enabled ? approvalActorId : null, config.enabled ? 1 : 0,
            config.is_required ? 1 : 0, config.enabled ? 1 : 0],
        );
      }
    }
    const [[saved]] = await connection.execute(
      `SELECT * FROM cgnat_exporter_configs WHERE organization_id = ?
        AND exporter_id = ? AND nat_instance_id = ? AND nat_pool_id = ? AND nat_realm = ?`,
      [organizationId, config.exporter_id, config.nat_instance_id,
        config.nat_pool_id, config.nat_realm],
    );
    await connection.commit();
    return publicExporterConfig(saved);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function approveReleaseRecovery(organizationId, exporterConfigId, body, {
  approvalActorId = null,
} = {}) {
  positiveInteger(organizationId, 'organization_id');
  positiveInteger(exporterConfigId, 'exporter_config_id');
  positiveInteger(approvalActorId, 'approval_actor_id');
  rejectUnknownFields(body, new Set(['collector_api_token_id', 'incident_reference']), 'body');
  const recoveryTokenId = positiveInteger(
    body.collector_api_token_id, 'collector_api_token_id',
  );
  const incidentReference = requiredString(
    body.incident_reference, 'incident_reference', 500,
  );
  if (!await collectorTokenIsValid(organizationId, recoveryTokenId)) {
    throw new ValidationError('collector_api_token_id must identify one active same-organization exact-scope CGNAT ingest token');
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      'SELECT id FROM organizations WHERE id = ? FOR UPDATE', [organizationId],
    );
    const [[config]] = await connection.execute(
      `SELECT * FROM cgnat_exporter_configs
        WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
      [exporterConfigId, organizationId],
    );
    if (!config) throw new NotFoundError('CGNAT exporter configuration');
    if (!Number(config.enabled) || !Number(config.is_required) || config.retired_at) {
      throw new ConflictError('Release recovery requires one active required exporter evidence epoch');
    }
    if (config.recovery_collector_api_token_id || config.recovery_approved_at) {
      throw new ConflictError('This exporter evidence epoch already has an approved release-recovery token');
    }
    if (Number(config.collector_api_token_id) === recoveryTokenId) {
      throw new ConflictError('Release recovery requires a different collector token');
    }
    if (await collectorTokenIsValid(organizationId, Number(config.collector_api_token_id))) {
      throw new ConflictError('The frozen collector token remains valid; incident recovery is not available');
    }
    const [[open]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM cgnat_attribution_bindings
        WHERE organization_id = ? AND exporter_config_id = ? AND released_at IS NULL`,
      [organizationId, exporterConfigId],
    );
    if (Number(open?.total || 0) === 0) {
      throw new ConflictError('Release recovery is only available while the epoch has open allocations');
    }
    const [owners] = await connection.execute(
      `SELECT id FROM cgnat_exporter_configs
        WHERE organization_id = ?
          AND (collector_api_token_id = ? OR recovery_collector_api_token_id = ?)
        LIMIT 1 FOR UPDATE`,
      [organizationId, recoveryTokenId, recoveryTokenId],
    );
    if (owners.length) {
      throw new ConflictError('A CGNAT collector token may be bound to only one exporter evidence epoch');
    }
    const [updated] = await connection.execute(
      `UPDATE cgnat_exporter_configs
          SET recovery_collector_api_token_id = ?, recovery_reference = ?,
              recovery_approved_by = ?, recovery_approved_at = NOW(3),
              incomplete_metadata_events = incomplete_metadata_events + 1,
              updated_at = NOW(3)
        WHERE id = ? AND organization_id = ?
          AND recovery_collector_api_token_id IS NULL`,
      [recoveryTokenId, incidentReference, approvalActorId,
        exporterConfigId, organizationId],
    );
    if (Number(updated.affectedRows) !== 1) {
      throw new ConflictError('Exporter evidence epoch changed before recovery was approved');
    }
    const [[saved]] = await connection.execute(
      'SELECT * FROM cgnat_exporter_configs WHERE id = ? AND organization_id = ?',
      [exporterConfigId, organizationId],
    );
    await connection.commit();
    return publicExporterConfig(saved);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listExporterConfigs(organizationId) {
  positiveInteger(organizationId, 'organization_id');
  const [rows] = await db.query(
    `SELECT id, exporter_id, exporter_nas_id, exporter_ip, nat_instance_id,
            nat_pool_id, nat_pool_record_id, collector_api_token_id,
            recovery_collector_api_token_id, recovery_reference,
            recovery_approved_by, recovery_approved_at,
            public_ipv4_start, public_ipv4_end,
            nat_realm, purpose_reference,
            tuple_exclusivity_confirmed, authoritative_baseline_confirmed,
            baseline_reference, baseline_confirmed_by, baseline_confirmed_at,
            collection_approved_by, collection_approved_at, is_required, enabled,
            retired_at, retired_by,
            last_binding_received_at, last_device_recorded_at,
            last_corrected_device_at, coverage_horizon_at,
            last_exporter_boot_id, last_sequence_number, sequence_gap_events,
            sequence_missing_records, out_of_order_events, reported_lost_records,
            incomplete_metadata_events, created_at, updated_at
       FROM cgnat_exporter_configs WHERE organization_id = ?
      ORDER BY exporter_id, nat_instance_id, nat_pool_id, nat_realm`,
    [organizationId],
  );
  return rows.map(publicExporterConfig);
}

module.exports = {
  ABSOLUTE_MAX_BATCH,
  MAX_CLOCK_UNCERTAINTY_MS,
  maxBatchSize,
  normalizeBinding,
  normalizeLookup,
  normalizeProtocol,
  isGloballyRoutableIpv4,
  ingestBatch,
  lookupAttribution,
  attributionToCsv,
  normalizeExporterConfig,
  publicExporterConfig,
  saveExporterConfig,
  approveReleaseRecovery,
  listExporterConfigs,
  metadataComplete,
  canonicalJson,
  certainlyCoversInstant,
  sequenceState,
};
