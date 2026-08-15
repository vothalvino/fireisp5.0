// =============================================================================
// FireISP 5.0 — tenant-safe subscriber session and IP-attribution routes
// =============================================================================

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const net = require('net');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission, userHasPermission } = require('../middleware/rbac');
const db = require('../config/database');
const auditLog = require('../services/auditLog');
const attributionService = require('../services/cgnatAttributionService');
const readinessService = require('../services/connectionLoggingReadinessService');
const config = require('../config');
const { ValidationError, ForbiddenError } = require('../utils/errors');
const { CacheStore, exportLimiter, apiTokenConfiguredLimiter } = require('../middleware/rateLimit');
const { buildUnverifiableSessionOverlap } = require('../utils/accountingUsageCompleteness');

const router = Router();
const SESSION_EXPORT_LIMIT = 50000;
const SESSION_EXPORT_MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
const SESSION_LIVENESS_MINUTES = Number.isSafeInteger(config.radiusSessionLivenessMinutes)
  && config.radiusSessionLivenessMinutes > 0 ? config.radiusSessionLivenessMinutes : 60;
const cgnatIngestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Math.min(Math.max(Number.parseInt(process.env.CGNAT_ATTRIBUTION_INGEST_REQUESTS_PER_MINUTE || '120', 10) || 120, 1), 600),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: req => `cgnat:${req.orgId}:${req.user?.apiTokenId || 'missing-token'}`,
  message: { error: { code: 'RATE_LIMITED', message: 'CGNAT collector request rate exceeded' } },
  store: new CacheStore('rl_cgnat_collector:'),
});

router.use(authenticate);
router.use(orgScope);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

function positiveQueryInteger(value, field, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be a positive integer` }]);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be between 1 and ${max}` }]);
  }
  return parsed;
}

function dateQuery(value, field, { dateOnly = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const pattern = dateOnly
    ? /^\d{4}-\d{2}-\d{2}$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== 'string' || !pattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be a valid ${dateOnly ? 'YYYY-MM-DD date' : 'ISO date/time'}` }]);
  }
  const timestamp = Date.parse(value);
  if (timestamp < Date.UTC(1970, 0, 1) || timestamp > Date.UTC(2038, 0, 19, 3, 14, 7)) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} is outside MySQL TIMESTAMP range` }]);
  }
  return value;
}

function requireExplicitIngestScope(req, resource) {
  let scopes = req.user?.scopes;
  if (typeof scopes === 'string') {
    try { scopes = JSON.parse(scopes); } catch { scopes = null; }
  }
  if (!Array.isArray(scopes) || scopes.length !== 1 || scopes[0] !== `${resource}:ingest`) {
    throw new ForbiddenError(`Collector token must contain only ${resource}:ingest`);
  }
}

function latestSessionPredicate(alias = 'cl') {
  return `(${alias}.session_instance_id IS NOT NULL OR ${alias}.id = (
    SELECT cl_latest.id FROM connection_logs cl_latest
     WHERE cl_latest.organization_id = ${alias}.organization_id
       AND cl_latest.session_instance_id IS NULL
       AND cl_latest.nas_id <=> ${alias}.nas_id
       AND cl_latest.username = ${alias}.username
       AND COALESCE(cl_latest.acct_session_id, cl_latest.session_id)
           <=> COALESCE(${alias}.acct_session_id, ${alias}.session_id)
       AND cl_latest.contract_id = ${alias}.contract_id
     ORDER BY COALESCE(cl_latest.last_accounting_at, cl_latest.event_at) DESC,
              cl_latest.id DESC LIMIT 1))`;
}

function sessionStartExpression(alias = 'cl') {
  // Application rows persist one lifecycle and store its true/synthetic start.
  // Deprecated direct-SQL rows are individual events; never MIN/group them
  // across a reused NAS-local Acct-Session-Id and invent one giant session.
  return `${alias}.event_at`;
}

function sessionActivityExpression(alias = 'cl') {
  return `COALESCE(${alias}.last_accounting_received_at, ${alias}.last_accounting_at, ${alias}.event_at)`;
}

function liveSessionPredicate(alias = 'cl') {
  return `${sessionActivityExpression(alias)} >= DATE_SUB(NOW(), INTERVAL ${SESSION_LIVENESS_MINUTES} MINUTE)`;
}

function sessionStateExpression(alias = 'cl') {
  return `CASE WHEN ${alias}.event_type = 'stop' THEN 'ended'
               WHEN NOT (${liveSessionPredicate(alias)}) THEN 'unknown'
               WHEN ${alias}.event_type = 'interim-update' THEN 'interim'
               ELSE 'active' END`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let string = String(value);
  if (/^[\t\r\n =+\-@]/.test(string)) string = `'${string}`;
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map(row => columns.map(column => csvEscape(row[column])).join(','))].join('\r\n');
}

async function logReportAccess(req, reportType, entityType, parameters, { govDataRequestId = null } = {}) {
  await db.withPrimaryContext(() => db.query(
    `INSERT INTO report_access_logs
       (organization_id, user_id, api_token_id, gov_data_request_id,
        report_type, entity_type, parameters,
        ip_address, user_agent, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [req.orgId, req.user.id, req.user.apiTokenId || null, govDataRequestId,
      reportType, entityType, JSON.stringify(parameters || {}),
      req.ip || null, req.get('user-agent') || null],
  ));
}

function requireInteractiveUser(req, _res, next) {
  if (req.user?.apiTokenId) return next(new ForbiddenError('Sensitive IP-attribution operations require an interactive user session'));
  return next();
}

function attributionAuditParameters(body, result = null, error = null, exportChecksum = null) {
  const normalized = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const queryHash = crypto.createHash('sha256').update(JSON.stringify({
    public_ipv4: normalized.public_ipv4 || null,
    public_port: normalized.public_port ?? null,
    protocol: normalized.protocol ?? null,
    observed_at: normalized.observed_at || null,
  })).digest('hex');
  return {
    query_hash: queryHash,
    outcome: result?.status || (error ? 'denied_or_failed' : 'unknown'),
    reason: result?.reason || error?.code || null,
    candidate_count: Number(result?.candidate_count || 0),
    attribution_method: result?.attributionMethod || null,
    evidence_snapshot_hash: result?.evidence_snapshot_hash || null,
    export_checksum: exportChecksum,
  };
}

function buildSessionWhere(organizationId, query, alias = 'cl') {
  const conditions = [`${alias}.organization_id = ?`];
  const params = [organizationId];
  const contractId = positiveQueryInteger(query.contract_id, 'contract_id');
  const clientId = positiveQueryInteger(query.client_id, 'client_id');
  if (contractId) { conditions.push(`${alias}.contract_id = ?`); params.push(contractId); }
  if (clientId) { conditions.push(`${alias}.client_id = ?`); params.push(clientId); }
  if (query.username) {
    if (typeof query.username !== 'string' || query.username.length > 64) throw new ValidationError('Invalid username');
    conditions.push(`${alias}.username = ?`); params.push(query.username);
  }
  if (query.ip_address) {
    if (typeof query.ip_address !== 'string' || query.ip_address.length > 64) throw new ValidationError('Invalid ip_address');
    const [address, prefix] = query.ip_address.split('/');
    const version = net.isIP(address);
    if (!version || (prefix !== undefined && (version !== 6 || !/^\d{1,3}$/.test(prefix)
        || Number(prefix) < 0 || Number(prefix) > 128))) throw new ValidationError('Invalid ip_address');
    if (version === 4) {
      conditions.push(`COALESCE(${alias}.framed_ip, ${alias}.ip_address) = ?`); params.push(query.ip_address);
    } else {
      conditions.push(`(${alias}.framed_ipv6_prefix = ? OR ${alias}.ipv6_delegated_prefix = ? OR ${alias}.ipv6_address = ?)`);
      params.push(query.ip_address, query.ip_address, query.ip_address);
    }
  }
  if (query.event_type) {
    if (!['start', 'interim-update', 'stop'].includes(query.event_type)) {
      throw new ValidationError('Invalid event_type', [{ field: 'event_type', message: 'event_type must be start, interim-update, or stop' }]);
    }
    conditions.push(`${alias}.event_type = ?`); params.push(query.event_type);
  }
  if (query.state) {
    const state = String(query.state).toLowerCase();
    if (!['active', 'interim', 'ended'].includes(state)) {
      throw new ValidationError('Invalid state', [{ field: 'state', message: 'state must be active, interim, or ended' }]);
    }
    if (state === 'ended') conditions.push(`${alias}.event_type = 'stop'`);
    if (state === 'interim') {
      conditions.push(`${alias}.event_type = 'interim-update'`);
      conditions.push(liveSessionPredicate(alias));
    }
    if (state === 'active') {
      conditions.push(`${alias}.event_type = 'start'`);
      conditions.push(liveSessionPredicate(alias));
    }
  }
  const sessionId = query.session_id || query.acct_session_id;
  if (sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length > 64) throw new ValidationError('Invalid session_id');
    conditions.push(`COALESCE(${alias}.acct_session_id, ${alias}.session_id) = ?`); params.push(sessionId);
  }
  if (query.mac) {
    if (typeof query.mac !== 'string' || query.mac.length > 100) throw new ValidationError('Invalid mac');
    const normalized = query.mac.toLowerCase().replace(/[:.-]/g, '');
    conditions.push(`REPLACE(REPLACE(REPLACE(LOWER(${alias}.calling_station_id), ':', ''), '.', ''), '-', '') LIKE ?`);
    params.push(`%${normalized}%`);
  }
  const nasFilter = query.nas_id || query.nas;
  if (nasFilter) {
    if (/^\d+$/.test(String(nasFilter))) {
      conditions.push(`${alias}.nas_id = ?`); params.push(positiveQueryInteger(String(nasFilter), 'nas'));
    } else {
      if (typeof nasFilter !== 'string' || nasFilter.length > 150) throw new ValidationError('Invalid nas');
      conditions.push(`EXISTS (SELECT 1 FROM nas filter_nas
        WHERE filter_nas.id = ${alias}.nas_id AND filter_nas.organization_id = ${alias}.organization_id
          AND (filter_nas.name LIKE ? OR filter_nas.ip_address = ?))`);
      params.push(`%${nasFilter}%`, nasFilter);
    }
  }
  if (query.date_from) { conditions.push(`${alias}.event_at >= ?`); params.push(dateQuery(query.date_from, 'date_from')); }
  if (query.date_to) { conditions.push(`${alias}.event_at <= ?`); params.push(dateQuery(query.date_to, 'date_to')); }
  if (query.date_from && query.date_to && Date.parse(query.date_from) > Date.parse(query.date_to)) {
    throw new ValidationError('Invalid date range', [{ field: 'date_to', message: 'date_to must not be before date_from' }]);
  }
  return { where: conditions.join(' AND '), params };
}

function requireBoundedSessionExport(query) {
  if (!query.date_from || !query.date_to) {
    throw new ValidationError('date_from and date_to are required for session exports');
  }
  const from = Date.parse(query.date_from);
  const to = Date.parse(query.date_to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new ValidationError('Invalid session export date range');
  }
  if (to - from > SESSION_EXPORT_MAX_WINDOW_MS) {
    throw new ValidationError('Session exports are limited to a 366-day window');
  }
}

router.get('/active/summary', requirePermission('connection_logs.summary'), async (req, res, next) => {
  try {
    const activeClause = `
      cl.event_type IN ('start', 'interim-update')
      AND ${latestSessionPredicate('cl')}
      AND COALESCE(cl.last_accounting_received_at, cl.last_accounting_at, cl.event_at) >=
          DATE_SUB(NOW(), INTERVAL ${SESSION_LIVENESS_MINUTES} MINUTE)`;
    const [nasSummary] = await db.query(
      `SELECT cl.nas_id, n.name AS nas_name, n.ip_address AS nas_ip,
              COUNT(DISTINCT COALESCE(cl.session_instance_id, CONCAT('legacy:', cl.id))) AS session_count
         FROM connection_logs cl
         LEFT JOIN nas n ON n.id = cl.nas_id AND n.organization_id = cl.organization_id
        WHERE cl.organization_id = ? AND ${activeClause}
        GROUP BY cl.nas_id, n.name, n.ip_address ORDER BY session_count DESC`,
      [req.orgId],
    );
    const data = [];
    for (const nasRow of nasSummary) {
      const [ports] = await db.query(
        `SELECT cl.nas_port_id,
                COUNT(DISTINCT COALESCE(cl.session_instance_id, CONCAT('legacy:', cl.id))) AS session_count
           FROM connection_logs cl
          WHERE cl.organization_id = ? AND cl.nas_id <=> ? AND ${activeClause}
          GROUP BY cl.nas_port_id ORDER BY session_count DESC`,
        [req.orgId, nasRow.nas_id],
      );
      data.push({ ...nasRow, ports });
    }
    res.json({ data, meta: {
      total_sessions: nasSummary.reduce((sum, row) => sum + Number(row.session_count), 0),
      nas_count: nasSummary.length,
    } });
  } catch (err) { next(err); }
});

router.get('/active', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const { username, ip_address: ipAddress, nas_ip_address: nasIp, mac, nas_port_id: nasPort } = req.query;
    const conditions = ['cl.organization_id = ?', "cl.event_type IN ('start', 'interim-update')"];
    const params = [req.orgId];
    if (username) { conditions.push('cl.username LIKE ?'); params.push(`%${String(username).slice(0, 64)}%`); }
    if (ipAddress) {
      conditions.push(`(COALESCE(cl.framed_ip, cl.ip_address) LIKE ?
        OR cl.framed_ipv6_prefix LIKE ? OR cl.ipv6_delegated_prefix LIKE ? OR cl.ipv6_address LIKE ?)`);
      const pattern = `%${String(ipAddress).slice(0, 64)}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    if (nasIp) { conditions.push('cl.nas_ip_address = ?'); params.push(String(nasIp).slice(0, 45)); }
    if (nasPort) { conditions.push('cl.nas_port_id = ?'); params.push(String(nasPort).slice(0, 100)); }
    if (mac) {
      const normalizedMac = String(mac).toLowerCase().replace(/[:.-]/g, '').slice(0, 100);
      conditions.push("REPLACE(REPLACE(REPLACE(LOWER(cl.calling_station_id), ':', ''), '.', ''), '-', '') LIKE ?");
      params.push(`%${normalizedMac}%`);
    }
    conditions.push(latestSessionPredicate('cl'));
    conditions.push(`COALESCE(cl.last_accounting_received_at, cl.last_accounting_at, cl.event_at) >= DATE_SUB(NOW(), INTERVAL ${SESSION_LIVENESS_MINUTES} MINUTE)`);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, Number.parseInt(req.query.limit, 10) || 50), 200);
    const offset = (page - 1) * limit;
    const where = conditions.join(' AND ');
    const [[rows], [countRows]] = await Promise.all([
      db.query(`SELECT cl.*, CASE WHEN cl.session_instance_id IS NULL THEN 'legacy_event' ELSE 'session' END AS record_kind,
                       COALESCE(cl.framed_ip, cl.ip_address) AS ip_address,
                       COALESCE(cl.acct_session_id, cl.session_id) AS radius_session_id,
                       ${sessionStartExpression('cl')} AS started_at,
                       ${sessionStartExpression('cl')} AS session_start,
                       NULL AS ended_at, NULL AS session_end,
                       COALESCE(cl.framed_ip, cl.ip_address) AS assigned_ipv4,
                       COALESCE(cl.framed_ipv6_prefix, cl.ipv6_delegated_prefix, cl.ipv6_address) AS assigned_ipv6,
                       cl.calling_station_id AS mac,
                       CASE WHEN cl.event_type = 'interim-update' THEN 'interim' ELSE 'active' END AS state
                  FROM connection_logs cl WHERE ${where}
                 ORDER BY cl.event_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
      db.query(`SELECT COUNT(*) AS total FROM connection_logs cl WHERE ${where}`, params),
    ]);
    await logReportAccess(req, 'subscriber_session_view', 'connection_logs', req.query);
    res.json({ data: rows, meta: { total: Number(countRows[0]?.total || 0), page, limit } });
  } catch (err) { next(err); }
});

router.get('/binding-report', exportLimiter, requirePermission('ip_pools.binding_report'), requirePermission('connection_logs.export'), async (req, res, next) => {
  try {
    const { from, to, ip, format = 'json' } = req.query;
    if (!['json', 'csv'].includes(format)) throw new ValidationError('format must be json or csv');
    const validFrom = dateQuery(from, 'from', { dateOnly: true });
    const validTo = dateQuery(to, 'to', { dateOnly: true });
    if (!validFrom || !validTo) throw new ValidationError('from and to query parameters are required');
    if (Date.parse(validFrom) > Date.parse(validTo)) throw new ValidationError('to must not be before from');
    if (Date.parse(validTo) - Date.parse(validFrom) > SESSION_EXPORT_MAX_WINDOW_MS) {
      throw new ValidationError('Binding reports are limited to a 366-day window');
    }
    const conditions = [
      'cl.organization_id = ?',
      `${sessionStartExpression('cl')} < DATE_ADD(?, INTERVAL 1 DAY)`,
      '(cl.event_type != \'stop\' OR COALESCE(cl.last_accounting_at, cl.event_at) >= ?)',
    ];
    const params = [req.orgId, validTo, validFrom];
    if (ip) { conditions.push('COALESCE(cl.framed_ip, cl.ip_address) = ?'); params.push(ip); }
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM connection_logs cl
        WHERE ${conditions.join(' AND ')}`,
      params,
    );
    const total = Number(countRows[0]?.total || 0);
    if (total > SESSION_EXPORT_LIMIT) {
      await logReportAccess(req, 'connection_binding_report_denied_too_large', 'connection_logs', {
        from, to, ip: ip || null, format, total, max: SESSION_EXPORT_LIMIT,
      });
      throw new ValidationError('Binding report exceeds the maximum row count', [{
        field: 'from', message: `query matches ${total} rows; narrow the dates to at most ${SESSION_EXPORT_LIMIT}`,
      }]);
    }
    const [rows] = await db.query(
      `SELECT CASE WHEN cl.session_instance_id IS NULL THEN 'legacy_event' ELSE 'session' END AS record_kind,
              cl.session_id, cl.acct_session_id, COALESCE(cl.framed_ip, cl.ip_address) AS ip_address,
              cl.framed_ipv6_prefix, cl.username, cl.calling_station_id AS mac_address,
              cl.nas_ip_address, cl.nas_port_id,
              ${sessionStartExpression('cl')} AS session_start,
              CASE WHEN cl.event_type = 'stop' THEN COALESCE(cl.last_accounting_at, cl.event_at) ELSE NULL END AS session_end,
              cl.event_type AS session_state, cl.terminate_cause, cl.contract_id, cl.client_id,
              (SELECT ia.pool_id FROM ip_assignments ia
                WHERE ia.ip_address = COALESCE(cl.framed_ip, cl.ip_address)
                  AND ia.organization_id = cl.organization_id
                  AND ia.assigned_at <= ${sessionStartExpression('cl')}
                  AND (ia.expires_at IS NULL OR ia.expires_at >= ${sessionStartExpression('cl')})
                ORDER BY ia.assigned_at DESC LIMIT 1) AS pool_id,
              c.name AS client_name, c.email AS client_email
         FROM connection_logs cl
         LEFT JOIN clients c ON c.id = cl.client_id AND c.organization_id = cl.organization_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY cl.event_at DESC LIMIT ${SESSION_EXPORT_LIMIT + 1}`, params,
    );
    if (rows.length > SESSION_EXPORT_LIMIT) {
      await logReportAccess(req, 'connection_binding_report_denied_too_large', 'connection_logs', {
        from, to, ip: ip || null, format, total: rows.length, max: SESSION_EXPORT_LIMIT,
      });
      throw new ValidationError('Binding report changed during export and exceeds the maximum row count');
    }
    await db.withPrimaryContext(() => auditLog.log({ userId: req.user.id, organizationId: req.orgId, action: 'export',
      tableName: 'connection_logs', recordId: 0,
      newValues: { from, to, ip: ip || null, format, exported_by: req.user.id } }));
    await logReportAccess(req, 'connection_binding_report', 'connection_logs', { from, to, ip: ip || null, format });
    if (format === 'csv') {
      const columns = ['record_kind', 'session_id', 'acct_session_id', 'ip_address', 'framed_ipv6_prefix',
        'username', 'mac_address', 'nas_ip_address', 'nas_port_id', 'session_start', 'session_end',
        'session_state', 'terminate_cause', 'contract_id', 'client_id', 'pool_id', 'client_name', 'client_email'];
      res.type('text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="binding-report-${from}-${to}.csv"`);
      return res.send(toCsv(rows, columns));
    }
    return res.json({ data: rows, meta: { from, to, total: rows.length } });
  } catch (err) { return next(err); }
});

router.get('/export', exportLimiter, requirePermission('connection_logs.export'), async (req, res, next) => {
  try {
    requireBoundedSessionExport(req.query);
    const { where, params } = buildSessionWhere(req.orgId, req.query);
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM connection_logs cl WHERE ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total || 0);
    if (total > SESSION_EXPORT_LIMIT) {
      await logReportAccess(req, 'subscriber_session_export_denied_too_large', 'connection_logs', {
        ...req.query, total, max: SESSION_EXPORT_LIMIT,
      });
      throw new ValidationError('Session export exceeds the maximum row count', [{
        field: 'date_from', message: `query matches ${total} rows; narrow the filters to at most ${SESSION_EXPORT_LIMIT}`,
      }]);
    }
    const [rows] = await db.query(
      `SELECT cl.*, CASE WHEN cl.session_instance_id IS NULL THEN 'legacy_event' ELSE 'session' END AS record_kind,
              COALESCE(cl.framed_ip, cl.ip_address) AS ip_address,
              COALESCE(cl.acct_session_id, cl.session_id) AS radius_session_id,
              ${sessionStartExpression('cl')} AS session_start,
              ${sessionStartExpression('cl')} AS started_at,
              CASE WHEN cl.event_type = 'stop' THEN COALESCE(cl.last_accounting_at, cl.event_at) ELSE NULL END AS session_end,
              CASE WHEN cl.event_type = 'stop' THEN COALESCE(cl.last_accounting_at, cl.event_at) ELSE NULL END AS ended_at,
              COALESCE(cl.framed_ip, cl.ip_address) AS assigned_ipv4,
              COALESCE(cl.framed_ipv6_prefix, cl.ipv6_delegated_prefix, cl.ipv6_address) AS assigned_ipv6,
              cl.calling_station_id AS mac,
              ${sessionStateExpression('cl')} AS state
         FROM connection_logs cl WHERE ${where}
         ORDER BY cl.event_at DESC LIMIT ${SESSION_EXPORT_LIMIT + 1}`, params,
    );
    if (rows.length > SESSION_EXPORT_LIMIT) {
      await logReportAccess(req, 'subscriber_session_export_denied_too_large', 'connection_logs', {
        ...req.query, total: rows.length, max: SESSION_EXPORT_LIMIT,
      });
      throw new ValidationError('Session export changed during export and exceeds the maximum row count');
    }
    await logReportAccess(req, 'subscriber_session_export', 'connection_logs', req.query);
    const columns = ['record_kind', 'id', 'organization_id', 'contract_id', 'client_id', 'nas_id', 'username',
      'session_id', 'acct_session_id', 'ip_address', 'framed_ipv6_prefix', 'nas_ip_address',
      'nas_port_id', 'calling_station_id', 'event_type', 'session_start', 'session_end',
      'bytes_in', 'bytes_out', 'packets_in', 'packets_out', 'session_duration', 'terminate_cause', 'stack_type'];
    res.type('text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="subscriber-sessions.csv"');
    return res.send(toCsv(rows, columns));
  } catch (err) { return next(err); }
});

router.get('/daily-usage', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const defaultTo = new Date(); const defaultFrom = new Date(); defaultFrom.setDate(defaultFrom.getDate() - 30);
    const from = req.query.date_from ? dateQuery(req.query.date_from, 'date_from', { dateOnly: true }) : defaultFrom.toISOString().slice(0, 10);
    const to = req.query.date_to ? dateQuery(req.query.date_to, 'date_to', { dateOnly: true }) : defaultTo.toISOString().slice(0, 10);
    const conditions = ['u.organization_id = ?', 'u.usage_date >= ?', 'u.usage_date <= ?'];
    const params = [req.orgId, from, to];
    const clientId = positiveQueryInteger(req.query.client_id, 'client_id');
    const contractId = positiveQueryInteger(req.query.contract_id, 'contract_id');
    if (clientId) { conditions.push('u.client_id = ?'); params.push(clientId); }
    if (contractId) { conditions.push('u.contract_id = ?'); params.push(contractId); }
    const where = conditions.join(' AND ');
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, Number.parseInt(req.query.limit, 10) || 50), 200);
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT u.usage_date, u.client_id, u.contract_id, u.username,
              COUNT(DISTINCT u.session_instance_id) AS session_count,
              COALESCE(SUM(u.bytes_in_delta), 0) AS bytes_in,
              COALESCE(SUM(u.bytes_out_delta), 0) AS bytes_out,
              COALESCE(SUM(u.bytes_in_delta + u.bytes_out_delta), 0) AS bytes_total,
              COALESCE(SUM(u.duration_delta), 0) AS duration_seconds,
              COALESCE(SUM(u.is_complete = 0), 0) AS incomplete_rows,
              (SELECT COUNT(*) FROM connection_logs unverifiable
                WHERE unverifiable.organization_id = u.organization_id
                  AND unverifiable.contract_id <=> u.contract_id
                  AND unverifiable.client_id <=> u.client_id
                  AND unverifiable.username <=> u.username
                  AND ${buildUnverifiableSessionOverlap(
    'unverifiable', 'u.usage_date', 'DATE_ADD(u.usage_date, INTERVAL 1 DAY)',
  )}) AS unverifiable_session_rows
         FROM radius_accounting_usage_daily u WHERE ${where}
        GROUP BY u.organization_id, u.usage_date, u.client_id, u.contract_id, u.username
        ORDER BY u.usage_date DESC, bytes_total DESC LIMIT ${limit} OFFSET ${offset}`, params,
    );
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM (SELECT 1 FROM radius_accounting_usage_daily u WHERE ${where}
        GROUP BY u.usage_date, u.client_id, u.contract_id, u.username) usage_rows`, params,
    );
    const data = rows.map(row => ({
      ...row,
      usage_complete: Number(row.incomplete_rows || 0) === 0
        && Number(row.unverifiable_session_rows || 0) === 0,
      unverifiable_session_rows: Number(row.unverifiable_session_rows || 0),
    }));
    res.json({ data, meta: { total: Number(countRows[0]?.total || 0), page, limit, date_from: from, date_to: to } });
  } catch (err) { next(err); }
});

router.get('/top-consumers', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const defaultTo = new Date(); const defaultFrom = new Date(); defaultFrom.setDate(defaultFrom.getDate() - 30);
    const from = req.query.date_from ? dateQuery(req.query.date_from, 'date_from', { dateOnly: true }) : defaultFrom.toISOString().slice(0, 10);
    const to = req.query.date_to ? dateQuery(req.query.date_to, 'date_to', { dateOnly: true }) : defaultTo.toISOString().slice(0, 10);
    const limit = Math.min(Math.max(1, Number.parseInt(req.query.limit, 10) || 10), 100);
    const [rows] = await db.query(
      `SELECT u.client_id, u.contract_id, u.username, COUNT(DISTINCT u.usage_date) AS active_days,
              COUNT(DISTINCT u.session_instance_id) AS session_count,
              COALESCE(SUM(u.bytes_in_delta), 0) AS bytes_in,
              COALESCE(SUM(u.bytes_out_delta), 0) AS bytes_out,
              COALESCE(SUM(u.bytes_in_delta + u.bytes_out_delta), 0) AS bytes_total,
              COALESCE(SUM(u.duration_delta), 0) AS duration_seconds,
              COALESCE(SUM(u.is_complete = 0), 0) AS incomplete_rows,
              (SELECT COUNT(*) FROM connection_logs unverifiable
                WHERE unverifiable.organization_id = u.organization_id
                  AND unverifiable.contract_id <=> u.contract_id
                  AND unverifiable.client_id <=> u.client_id
                  AND unverifiable.username <=> u.username
                  AND ${buildUnverifiableSessionOverlap('unverifiable')}) AS unverifiable_session_rows
         FROM radius_accounting_usage_daily u WHERE u.organization_id = ?
          AND u.usage_date >= ? AND u.usage_date <= ?
        GROUP BY u.organization_id, u.client_id, u.contract_id, u.username
        ORDER BY bytes_total DESC LIMIT ${limit}`,
      [from, to, req.orgId, from, to],
    );
    const data = rows.map(row => ({
      ...row,
      usage_complete: Number(row.incomplete_rows || 0) === 0
        && Number(row.unverifiable_session_rows || 0) === 0,
      unverifiable_session_rows: Number(row.unverifiable_session_rows || 0),
    }));
    res.json({ data, meta: { date_from: from, date_to: to, limit } });
  } catch (err) { next(err); }
});

router.post('/cgnat-attribution/bindings/ingest', cgnatIngestLimiter, apiTokenConfiguredLimiter, requirePermission('cgnat_attribution.ingest'), async (req, res, next) => {
  try {
    if (!req.user.apiTokenId) {
      throw new ForbiddenError('CGNAT attribution ingestion requires an organization API token (X-API-Key)');
    }
    requireExplicitIngestScope(req, 'cgnat_attribution');
    const result = await attributionService.ingestBatch(req.orgId, req.body, {
      apiTokenId: req.user.apiTokenId,
      requestId: req.id,
      sourceIp: req.ip,
      userAgent: req.get('user-agent'),
    });
    await db.withPrimaryContext(() => auditLog.log({ userId: req.user.id, organizationId: req.orgId, action: 'ingest',
      tableName: 'cgnat_binding_events', recordId: 0,
      newValues: { ...result, api_token_id: req.user.apiTokenId || null } }));
    res.status(200).json({ data: result });
  } catch (err) { next(err); }
});

router.get('/cgnat-attribution/exporters', requireInteractiveUser,
  requirePermission('cgnat_attribution.manage'), async (req, res, next) => {
    try {
      res.json({ data: await attributionService.listExporterConfigs(req.orgId) });
    } catch (err) { next(err); }
  });

router.put('/cgnat-attribution/exporters', requireInteractiveUser,
  requirePermission('cgnat_attribution.manage'), async (req, res, next) => {
    try {
      if (req.user?.apiTokenId) throw new ForbiddenError('CGNAT exporter approval requires an interactive user session');
      const saved = await attributionService.saveExporterConfig(req.orgId, req.body, {
        approvalActorId: req.user.id,
      });
      await auditLog.log({ userId: req.user.id, organizationId: req.orgId,
        action: 'configure', tableName: 'cgnat_exporter_configs', recordId: saved.id,
        newValues: { exporter_id: saved.exporter_id, nat_instance_id: saved.nat_instance_id,
          nat_pool_id: saved.nat_pool_id, nat_realm: saved.nat_realm,
          exporter_nas_id: saved.exporter_nas_id ? Number(saved.exporter_nas_id) : null,
          exporter_ip: saved.exporter_ip || null,
          nat_pool_record_id: Number(saved.nat_pool_record_id),
          public_ipv4_start: saved.public_ipv4_start, public_ipv4_end: saved.public_ipv4_end,
          collector_api_token_id: Number(saved.collector_api_token_id),
          is_required: Boolean(saved.is_required), enabled: Boolean(saved.enabled),
          retired_at: saved.retired_at || null, retired_by: saved.retired_by || null,
          collection_approved_by: saved.collection_approved_by || null,
          collection_approved_at: saved.collection_approved_at || null,
          tuple_exclusivity_confirmed: Boolean(saved.tuple_exclusivity_confirmed),
          authoritative_baseline_confirmed: Boolean(saved.authoritative_baseline_confirmed),
          baseline_reference: saved.baseline_reference || null,
          baseline_confirmed_by: saved.baseline_confirmed_by || null,
          baseline_confirmed_at: saved.baseline_confirmed_at || null,
          purpose_reference: saved.purpose_reference || null } });
      res.json({ data: saved });
    } catch (err) { next(err); }
  });

router.post('/cgnat-attribution/exporters/:id/release-recovery', requireInteractiveUser,
  requirePermission('cgnat_attribution.manage'), async (req, res, next) => {
    try {
      const exporterConfigId = positiveQueryInteger(
        req.params.id, 'exporter_config_id',
      );
      const saved = await attributionService.approveReleaseRecovery(
        req.orgId, exporterConfigId, req.body, { approvalActorId: req.user.id },
      );
      await auditLog.log({
        userId: req.user.id,
        organizationId: req.orgId,
        action: 'approve_release_recovery',
        tableName: 'cgnat_exporter_configs',
        recordId: saved.id,
        summary: 'Approved a release-only collector after the frozen token became unavailable; the epoch remains permanently fail-closed',
        newValues: {
          exporter_id: saved.exporter_id,
          nat_instance_id: saved.nat_instance_id,
          nat_pool_id: saved.nat_pool_id,
          recovery_collector_api_token_id: saved.recovery_collector_api_token_id,
          recovery_reference: saved.recovery_reference,
          recovery_approved_by: saved.recovery_approved_by,
          recovery_approved_at: saved.recovery_approved_at,
          evidence_epoch_faulted: true,
        },
      });
      res.json({ data: saved });
    } catch (err) { next(err); }
  });

router.post('/ip-attribution/lookup', requireInteractiveUser,
  requirePermission('gov_data_requests.view'), requirePermission('ip_attribution.view'),
  async (req, res, next) => {
    try {
      const result = await attributionService.lookupAttribution(req.orgId, req.body, {
        actorId: req.user.id, pin: true,
      });
      const requestId = Number(req.body?.gov_data_request_id);
      await logReportAccess(req, 'ip_attribution_lookup', 'ip_attribution_case_evidence',
        attributionAuditParameters(req.body, result), {
          govDataRequestId: Number.isSafeInteger(requestId) && requestId > 0 ? requestId : null,
        });
      res.json({ data: result });
    } catch (err) {
      const requestId = Number(req.body?.gov_data_request_id);
      try {
        await logReportAccess(req, 'ip_attribution_lookup', 'ip_attribution_case_evidence',
          attributionAuditParameters(req.body, null, err), {
            govDataRequestId: Number.isSafeInteger(requestId) && requestId > 0 ? requestId : null,
          });
      } catch (auditError) { return next(auditError); }
      return next(err);
    }
  });

router.post('/ip-attribution/export', exportLimiter, requireInteractiveUser,
  requirePermission('gov_data_requests.view'), requirePermission('ip_attribution.export'),
  async (req, res, next) => {
    try {
      const result = await attributionService.lookupAttribution(req.orgId, req.body, {
        actorId: req.user.id, pin: true,
      });
      const csv = attributionService.attributionToCsv(result);
      const checksum = crypto.createHash('sha256').update(csv).digest('hex');
      const requestId = Number(req.body?.gov_data_request_id);
      await logReportAccess(req, 'ip_attribution_export', 'ip_attribution_case_evidence',
        attributionAuditParameters(req.body, result, null, checksum), {
          govDataRequestId: Number.isSafeInteger(requestId) && requestId > 0 ? requestId : null,
        });
      res.type('text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ip-attribution-case-${result.gov_data_request_id}.csv"`);
      res.setHeader('X-Evidence-SHA256', checksum);
      res.send(csv);
    } catch (err) {
      const requestId = Number(req.body?.gov_data_request_id);
      try {
        await logReportAccess(req, 'ip_attribution_export', 'ip_attribution_case_evidence',
          attributionAuditParameters(req.body, null, err), {
            govDataRequestId: Number.isSafeInteger(requestId) && requestId > 0 ? requestId : null,
          });
      } catch (auditError) { return next(auditError); }
      return next(err);
    }
  });

router.get('/readiness', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const [canManageCgnat, canViewAttribution] = await Promise.all([
      userHasPermission(req, 'cgnat_attribution.manage'),
      userHasPermission(req, 'ip_attribution.view'),
    ]);
    const data = await readinessService.getReadiness(req.orgId, {
      includeCgnat: canManageCgnat || canViewAttribution,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const { where, params } = buildSessionWhere(req.orgId, req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, Number.parseInt(req.query.limit, 10) || 50), 200);
    const offset = (page - 1) * limit;
    const [[rows], [countRows]] = await Promise.all([
      db.query(`SELECT cl.*, CASE WHEN cl.session_instance_id IS NULL THEN 'legacy_event' ELSE 'session' END AS record_kind,
                       COALESCE(cl.framed_ip, cl.ip_address) AS ip_address,
                       COALESCE(cl.acct_session_id, cl.session_id) AS radius_session_id,
                       ${sessionStartExpression('cl')} AS session_start,
                       ${sessionStartExpression('cl')} AS started_at,
                       CASE WHEN cl.event_type = 'stop'
                            THEN COALESCE(cl.last_accounting_at, cl.event_at)
                            ELSE NULL END AS session_end,
                       CASE WHEN cl.event_type = 'stop'
                            THEN COALESCE(cl.last_accounting_at, cl.event_at)
                            ELSE NULL END AS ended_at,
                       COALESCE(cl.framed_ip, cl.ip_address) AS assigned_ipv4,
                       COALESCE(cl.framed_ipv6_prefix, cl.ipv6_delegated_prefix, cl.ipv6_address) AS assigned_ipv6,
                       cl.calling_station_id AS mac,
                       ${sessionStateExpression('cl')} AS state,
                       client_row.name AS client_name, nas_row.name AS nas_name
                  FROM connection_logs cl
                  LEFT JOIN clients client_row ON client_row.id = cl.client_id
                    AND client_row.organization_id = cl.organization_id
                  LEFT JOIN nas nas_row ON nas_row.id = cl.nas_id
                    AND nas_row.organization_id = cl.organization_id
                 WHERE ${where}
                 ORDER BY cl.event_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
      db.query(`SELECT COUNT(*) AS total FROM connection_logs cl WHERE ${where}`, params),
    ]);
    await logReportAccess(req, 'subscriber_session_view', 'connection_logs', req.query);
    res.json({ data: rows, meta: { total: Number(countRows[0]?.total || 0), page, limit } });
  } catch (err) { next(err); }
});

module.exports = router;
