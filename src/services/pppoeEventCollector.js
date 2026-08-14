// =============================================================================
// FireISP 5.0 — RouterOS PPPoE event collector
// =============================================================================
// Polls the in-memory RouterOS log using the read-only `/log/print` API command.
// RouterOS does not support regex query words in its binary API, so topic/message
// filtering happens locally. Only the newest bounded slice is parsed; a stable
// SHA-256 source key makes repeated polls idempotent.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const routerProvisioningService = require('./routerProvisioningService');
const routerosService = require('./routerosService');
const { parseRouterOsLogLine } = require('./pppoeDiagnosticsService');
const { canonicalizeMac } = require('../middleware/validatePppoeEvent');
const logger = require('../utils/logger').child({ service: 'pppoeEventCollector' });

const DEFAULT_POLL_LIMIT = 500;
const MIN_POLL_LIMIT = 50;
const MAX_POLL_LIMIT = 1000;

const MONTHS = new Map([
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['may', 4], ['jun', 5],
  ['jul', 6], ['aug', 7], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
]);

function getPollLimit() {
  const requested = Number.parseInt(process.env.PPPOE_EVENT_POLL_LIMIT || '', 10);
  if (!Number.isFinite(requested)) return DEFAULT_POLL_LIMIT;
  return Math.min(MAX_POLL_LIMIT, Math.max(MIN_POLL_LIMIT, requested));
}

/** Extract the most useful subscriber identifiers present in common RouterOS messages. */
function deriveEventIdentity(message) {
  if (typeof message !== 'string') return { username: null, mac: null };

  const macMatch = message.match(/\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b/);
  const mac = macMatch ? canonicalizeMac(macMatch[0]) : null;

  const usernamePatterns = [
    /<([^<>\s]{1,64})>\s*:/,
    /\b(?:user(?:name)?|login)\s*(?:=|:|\s)\s*["']?([A-Za-z0-9._@-]{1,64})/i,
    /(?:^|:\s*)([A-Za-z0-9._@-]{1,64})(?::|\s+(?:authenticated|disconnected|connected|logged\s+(?:in|out))\b)/i,
  ];

  let username = null;
  for (const pattern of usernamePatterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const candidate = match[1].replace(/["']$/, '');
    // Topic/protocol labels can occupy the same syntactic position as a user.
    // Avoid stamping those as subscriber identities.
    if (!/^(?:ppp|pppoe|lcp|ipcp|ipv6cp|auth|radius)$/i.test(candidate)) {
      username = candidate;
      break;
    }
  }

  return { username, mac };
}

/**
 * Convert RouterOS log timestamps to a Date.
 * Handles ISO/MySQL datetimes, `aug/14/2026 15:04:05`, `aug/14 15:04:05`,
 * and time-only entries from the current in-memory log buffer.
 */
function parseRouterLogTime(value, now = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();

  const monthDate = raw.match(/^([a-z]{3})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/i);
  if (monthDate) {
    const month = MONTHS.get(monthDate[1].toLowerCase());
    if (month === undefined) return null;
    const explicitYear = monthDate[3] ? Number(monthDate[3]) : null;
    let year = explicitYear || now.getFullYear();
    let date = new Date(year, month, Number(monthDate[2]), Number(monthDate[4]), Number(monthDate[5]), Number(monthDate[6]));
    // Around New Year, a year-less December entry read in January belongs to
    // the previous year, not eleven months in the future.
    if (!explicitYear && date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      year -= 1;
      date = new Date(year, month, Number(monthDate[2]), Number(monthDate[4]), Number(monthDate[5]), Number(monthDate[6]));
    }
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const timeOnly = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (timeOnly) {
    const date = new Date(now);
    date.setHours(Number(timeOnly[1]), Number(timeOnly[2]), Number(timeOnly[3]), 0);
    // A late-night record read just after midnight belongs to yesterday.
    if (date.getTime() > now.getTime() + 60 * 60 * 1000) date.setDate(date.getDate() - 1);
    return date;
  }

  const parsed = new Date(raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function makeSourceKey(nasId, attrs) {
  return crypto.createHash('sha256').update([
    String(nasId),
    attrs['.id'] || '',
    attrs.time || '',
    attrs.topics || '',
    attrs.message || '',
  ].join('\0')).digest('hex');
}

function rowsFromSentences(sentences) {
  return sentences
    .filter((sentence) => Array.isArray(sentence) && sentence[0] === '!re')
    .map((sentence) => routerosService.parseAttrs(sentence.slice(1)))
    .filter((attrs) => typeof attrs.message === 'string');
}

function hasPppTopic(topics) {
  if (typeof topics !== 'string') return false;
  return topics.split(',').some((topic) => /^(?:ppp|pppoe)$/i.test(topic.trim()));
}

async function insertEvents(events) {
  if (!events.length) return 0;

  const placeholders = events.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const values = [];
  for (const event of events) {
    values.push(
      event.organizationId,
      event.nasId,
      event.username,
      event.mac,
      event.stage,
      event.severity,
      event.message,
      event.reasonCode,
      event.loggedAt,
      event.sourceKey,
    );
  }

  const [result] = await db.query(
    `INSERT IGNORE INTO pppoe_event_logs
       (organization_id, nas_id, username, mac, stage, severity, message,
        reason_code, logged_at, source_key)
     VALUES ${placeholders}`,
    values,
  );
  return Number(result.affectedRows || 0);
}

async function collectNas(nas, limit) {
  let client = null;
  try {
    const conn = routerProvisioningService.nasToConn(nas);
    client = await routerosService.createClient(conn);
    const sentences = await client.run([
      '/log/print',
      '=.proplist=.id,time,topics,message',
    ]);
    const allRows = rowsFromSentences(sentences);
    const consideredRows = allRows.slice(-limit);
    const events = [];

    for (const attrs of consideredRows) {
      // Generic words such as "connected" also occur in interface, routing,
      // and system logs. RouterOS provides authoritative comma-separated log
      // topics, so only PPP/PPPoE records may feed PPPoE diagnostics.
      if (!hasPppTopic(attrs.topics)) continue;
      const parsed = parseRouterOsLogLine(attrs.message);
      if (!parsed) continue;
      const identity = deriveEventIdentity(attrs.message);
      events.push({
        organizationId: nas.organization_id,
        nasId: nas.id,
        username: identity.username,
        mac: identity.mac,
        stage: parsed.stage,
        severity: parsed.severity,
        message: parsed.message,
        reasonCode: parsed.reason_code,
        loggedAt: parseRouterLogTime(attrs.time) || new Date(),
        sourceKey: makeSourceKey(nas.id, attrs),
      });
    }

    const inserted = await insertEvents(events);
    return {
      logsRead: allRows.length,
      logsConsidered: consideredRows.length,
      eventsRecognized: events.length,
      inserted,
      deduplicated: events.length - inserted,
    };
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (err) {
        logger.warn({ err: err.message, nasId: nas.id }, 'RouterOS client close failed after PPPoE log poll');
      }
    }
  }
}

function emptySummary(limit = getPollLimit()) {
  return {
    nasTotal: 0,
    nasSucceeded: 0,
    nasFailed: 0,
    logsRead: 0,
    logsConsidered: 0,
    eventsRecognized: 0,
    inserted: 0,
    deduplicated: 0,
    pollLimit: limit,
    failures: [],
  };
}

function mergeSummary(target, source) {
  for (const key of [
    'nasTotal', 'nasSucceeded', 'nasFailed', 'logsRead', 'logsConsidered',
    'eventsRecognized', 'inserted', 'deduplicated',
  ]) target[key] += source[key];
  target.failures.push(...source.failures);
}

/** Poll one database scope. The caller is responsible for selecting its DB context. */
async function collectCurrentDatabase(organizationId, excludeIsolatedTenants = false) {
  let sql = `SELECT n.id, n.organization_id, n.name, n.ip_address, n.api_port,
                    n.api_username, n.api_password_encrypted, n.api_use_tls,
                    n.access_mode
               FROM nas n
               LEFT JOIN nas_wg_tunnels wg
                 ON wg.nas_id = n.id AND wg.deleted_at IS NULL
              WHERE n.status = 'active'
                AND n.maintenance_mode = 0
                AND n.deleted_at IS NULL
                AND n.organization_id IS NOT NULL
                AND LOWER(n.type) = 'mikrotik'
                AND n.api_username IS NOT NULL AND n.api_username <> ''
                AND n.api_password_encrypted IS NOT NULL AND n.api_password_encrypted <> ''
                AND (
                  n.access_mode <> 'nated'
                  OR (
                    wg.id IS NOT NULL
                    AND wg.state IN ('active', 'manual')
                    AND wg.server_peer_synced = 1
                  )
                )`;
  const params = [];
  if (excludeIsolatedTenants) {
    // The primary DB can retain historical tenant rows after an organization
    // switches to an isolated database. Never poll those stale copies.
    sql += ` AND NOT EXISTS (
      SELECT 1
        FROM organization_database_configs odc
       WHERE odc.organization_id = n.organization_id
         AND odc.isolation_mode = 'isolated'
    )`;
  }
  if (organizationId !== null && organizationId !== undefined) {
    sql += ' AND n.organization_id = ?';
    params.push(organizationId);
  }
  sql += ' ORDER BY n.id';

  const [nasRows] = await db.query(sql, params);
  const limit = getPollLimit();
  const summary = emptySummary(limit);
  summary.nasTotal = nasRows.length;

  // Sequential polling is deliberate: a scheduled sweep must not open a burst
  // of API sockets against every access concentrator at once.
  for (const nas of nasRows) {
    try {
      const result = await collectNas(nas, limit);
      summary.nasSucceeded += 1;
      summary.logsRead += result.logsRead;
      summary.logsConsidered += result.logsConsidered;
      summary.eventsRecognized += result.eventsRecognized;
      summary.inserted += result.inserted;
      summary.deduplicated += result.deduplicated;
    } catch (err) {
      summary.nasFailed += 1;
      summary.failures.push({ nasId: nas.id, message: err.message });
      logger.warn({ err: err.message, nasId: nas.id }, 'PPPoE RouterOS log poll failed; continuing with remaining NAS devices');
    }
  }

  logger.info(summary, 'PPPoE RouterOS log poll completed');
  return summary;
}

/**
 * Poll active MikroTik NAS devices with configured RouterOS API credentials.
 * One device or isolated database failure never prevents the remaining fleet
 * from being collected. A global run fans out through the application's
 * supported per-tenant database contexts instead of silently scanning only
 * the primary database.
 *
 * @param {number|null} organizationId optional tenant filter for a manual run
 */
async function collectPppoeEvents(organizationId = null) {
  if (organizationId !== null && organizationId !== undefined) {
    return db.withTenantContext(
      organizationId,
      () => collectCurrentDatabase(organizationId),
    );
  }

  const isolatedOrganizationIds = await db.withPrimaryContext(async () => {
    const [rows] = await db.query(
      `SELECT odc.organization_id
         FROM organization_database_configs odc
         JOIN organizations o ON o.id = odc.organization_id
        WHERE odc.isolation_mode = 'isolated'
          AND o.status = 'active'
          AND o.deleted_at IS NULL
        ORDER BY odc.organization_id`,
    );
    return rows.map((row) => row.organization_id);
  });

  const aggregate = emptySummary();
  aggregate.databaseScopesTotal = 1 + isolatedOrganizationIds.length;
  aggregate.databaseScopesSucceeded = 0;
  aggregate.databaseScopesFailed = 0;

  try {
    const shared = await db.withPrimaryContext(
      () => collectCurrentDatabase(null, true),
    );
    mergeSummary(aggregate, shared);
    aggregate.databaseScopesSucceeded += 1;
  } catch (err) {
    aggregate.databaseScopesFailed += 1;
    aggregate.failures.push({ organizationId: null, message: err.message });
    logger.warn({ err: err.message }, 'Primary PPPoE event database sweep failed; continuing with isolated tenants');
  }

  for (const isolatedOrganizationId of isolatedOrganizationIds) {
    try {
      const tenant = await db.withTenantContext(
        isolatedOrganizationId,
        () => collectCurrentDatabase(isolatedOrganizationId),
      );
      mergeSummary(aggregate, tenant);
      aggregate.databaseScopesSucceeded += 1;
    } catch (err) {
      aggregate.databaseScopesFailed += 1;
      aggregate.failures.push({ organizationId: isolatedOrganizationId, message: err.message });
      logger.warn(
        { err: err.message, organizationId: isolatedOrganizationId },
        'Isolated-tenant PPPoE event database sweep failed; continuing',
      );
    }
  }

  logger.info(aggregate, 'Global PPPoE RouterOS log poll completed');
  return aggregate;
}

module.exports = {
  DEFAULT_POLL_LIMIT,
  collectPppoeEvents,
  deriveEventIdentity,
  getPollLimit,
  hasPppTopic,
  makeSourceKey,
  parseRouterLogTime,
};
