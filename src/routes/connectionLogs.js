// =============================================================================
// FireISP 5.0 — Connection Log Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');
const auditLog = require('../services/auditLog');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// GET /active/summary — active session counts grouped by NAS and port
// MUST be registered before GET /active to ensure correct route matching order
router.get('/active/summary', requirePermission('connection_logs.summary'), async (req, res, next) => {
  try {
    const activeExistsClause = `
      AND NOT EXISTS (
        SELECT 1 FROM connection_logs cl2
        WHERE cl2.session_id = cl.session_id
          AND cl2.contract_id = cl.contract_id
          AND cl2.event_type = 'stop'
      )
    `;

    const [nasSummary] = await db.query(`
      SELECT
        cl.nas_id,
        n.name AS nas_name,
        n.ip_address AS nas_ip,
        COUNT(*) AS session_count
      FROM connection_logs cl
      LEFT JOIN nas n ON n.id = cl.nas_id
      WHERE cl.event_type = 'start'
        ${activeExistsClause}
      GROUP BY cl.nas_id, n.name, n.ip_address
      ORDER BY session_count DESC
    `);

    // For each NAS, fetch port-level breakdown
    const data = [];
    for (const nasRow of nasSummary) {
      const portParams = [nasRow.nas_id];
      const [ports] = await db.query(`
        SELECT cl.nas_port_id, COUNT(*) AS session_count
        FROM connection_logs cl
        WHERE cl.event_type = 'start'
          AND cl.nas_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM connection_logs cl2
            WHERE cl2.session_id = cl.session_id
              AND cl2.contract_id = cl.contract_id
              AND cl2.event_type = 'stop'
          )
        GROUP BY cl.nas_port_id
        ORDER BY session_count DESC
      `, portParams);

      data.push({
        nas_id: nasRow.nas_id,
        nas_name: nasRow.nas_name,
        nas_ip: nasRow.nas_ip,
        session_count: nasRow.session_count,
        ports,
      });
    }

    const total_sessions = nasSummary.reduce((sum, r) => sum + Number(r.session_count), 0);

    res.json({
      data,
      meta: {
        total_sessions,
        nas_count: nasSummary.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /active — live PPPoE sessions (start events with no corresponding stop)
router.get('/active', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const { username, ip_address, nas_ip_address, mac, nas_port_id, page = 1, limit = 50 } = req.query;

    // All user-supplied values go exclusively into parameterized placeholders.
    // The conditions array contains only hardcoded SQL fragments; no user input
    // is ever interpolated into the query string.
    const conditions = [];
    const params = [];

    if (username) { conditions.push('cl.username LIKE ?'); params.push(`%${username}%`); }
    if (ip_address) { conditions.push('cl.ip_address LIKE ?'); params.push(`%${ip_address}%`); }
    if (nas_ip_address) { conditions.push('cl.nas_ip_address = ?'); params.push(nas_ip_address); }
    if (nas_port_id) { conditions.push('cl.nas_port_id = ?'); params.push(nas_port_id); }

    // MAC filter: normalize by stripping separators, compare lowercase
    if (mac) {
      const normalizedMac = mac.toLowerCase().replace(/[:.\\-]/g, '');
      conditions.push(
        "REPLACE(REPLACE(REPLACE(LOWER(cl.calling_station_id), ':', ''), '.', ''), '-', '') LIKE ?",
      );
      params.push(`%${normalizedMac}%`);
    }

    // Build the extra filter clause from the hardcoded fragments list.
    const extraConditions = conditions.length
      ? `AND ${conditions.join(' AND ')}`
      : '';
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const safeOffset = (Math.max(1, parseInt(page, 10) || 1) - 1) * safeLimit;

    const activeSql = `
      SELECT cl.*
      FROM connection_logs cl
      WHERE cl.event_type = 'start'
        AND NOT EXISTS (
          SELECT 1 FROM connection_logs cl2
          WHERE cl2.session_id = cl.session_id
            AND cl2.contract_id = cl.contract_id
            AND cl2.event_type = 'stop'
        )
        ${extraConditions}
        AND ? >= 0 AND ? >= 0
      ORDER BY cl.event_at DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;

    const countSql = `
      SELECT COUNT(*) AS total
      FROM connection_logs cl
      WHERE cl.event_type = 'start'
        AND NOT EXISTS (
          SELECT 1 FROM connection_logs cl2
          WHERE cl2.session_id = cl.session_id
            AND cl2.contract_id = cl.contract_id
            AND cl2.event_type = 'stop'
        )
        ${extraConditions}
    `;

    const [rows] = await db.query(activeSql, [...params, safeLimit, safeOffset]);
    const [countResult] = await db.query(countSql, params);

    res.json({
      data: rows,
      meta: { total: countResult[0].total, page: Math.max(1, parseInt(page, 10) || 1), limit: safeLimit },
    });
  } catch (err) {
    next(err);
  }
});

// GET /binding-report — IP binding history export (MUST be before generic GET /)
router.get('/binding-report', requirePermission('ip_pools.binding_report'), async (req, res, next) => {
  try {
    const { from, to, ip, format = 'json' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query parameters are required' });
    }

    // One row per session: Stop/Interim events update the Start row in place
    // (see radiusAccountingService), so no event_type filter — event_type
    // reflects the session's latest known state.
    const conditions = [
      'cl.event_at >= ?',
      'cl.event_at <= ?',
      // Org scoping: connection_logs has no organization_id — scope through
      // the linked client, falling back to the NAS for unlinked sessions.
      `(c.organization_id = ?
        OR (cl.client_id IS NULL AND EXISTS (
          SELECT 1 FROM nas n WHERE n.id = cl.nas_id AND n.organization_id = ?
        )))`,
    ];
    const params = [from, to, req.orgId, req.orgId];

    if (ip) {
      conditions.push('COALESCE(cl.framed_ip, cl.ip_address) = ?');
      params.push(ip);
    }

    const where = conditions.join(' AND ');

    const [rows] = await db.query(`
      SELECT
        cl.session_id,
        cl.acct_session_id,
        COALESCE(cl.framed_ip, cl.ip_address) AS ip_address,
        cl.framed_ipv6_prefix,
        cl.username,
        cl.calling_station_id AS mac_address,
        cl.nas_ip_address,
        cl.nas_port_id,
        cl.event_at AS session_start,
        CASE WHEN cl.event_type = 'stop'
             THEN DATE_ADD(cl.event_at, INTERVAL COALESCE(cl.session_duration, 0) SECOND)
             ELSE NULL END AS session_end,
        cl.event_type AS session_state,
        cl.terminate_cause,
        cl.contract_id,
        cl.client_id,
        (SELECT ia.pool_id FROM ip_assignments ia
          WHERE ia.ip_address = COALESCE(cl.framed_ip, cl.ip_address)
            AND ia.organization_id = ?
            AND ia.deleted_at IS NULL
          ORDER BY ia.assigned_at DESC LIMIT 1) AS pool_id,
        c.name AS client_name,
        c.email AS client_email
      FROM connection_logs cl
      LEFT JOIN clients c ON c.id = cl.client_id
      WHERE ${where}
      ORDER BY cl.event_at DESC
    `, [req.orgId, ...params]);

    // Audit log every export
    await auditLog.log({
      userId: req.user.id,
      organizationId: req.orgId,
      action: 'export',
      tableName: 'connection_logs',
      recordId: 0,
      newValues: { from, to, ip: ip || null, format, exported_by: req.user.id },
    });

    if (format === 'csv') {
      const headers = [
        'session_id', 'acct_session_id', 'ip_address', 'framed_ipv6_prefix',
        'username', 'mac_address', 'nas_ip_address', 'nas_port_id',
        'session_start', 'session_end', 'session_state', 'terminate_cause',
        'contract_id', 'client_id', 'pool_id', 'client_name', 'client_email',
      ];
      const csvEscape = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      const csvRows = [
        headers.join(','),
        ...rows.map(r => headers.map(h => csvEscape(r[h])).join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="binding-report-${from}-${to}.csv"`);
      return res.send(csvRows.join('\n'));
    }

    return res.json({
      data: rows,
      meta: { from, to, total: rows.length },
    });
  } catch (err) {
    next(err);
  }
});

// GET /daily-usage — data usage aggregated per client per day
router.get('/daily-usage', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const {
      client_id, contract_id, date_from, date_to,
      page = 1, limit = 50,
    } = req.query;

    // Default: last 30 days when no date range supplied
    const defaultTo = new Date();
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);

    const from = date_from || defaultFrom.toISOString().slice(0, 10);
    const to = date_to || defaultTo.toISOString().slice(0, 10);

    // All user-supplied values go exclusively into parameterized placeholders.
    const conditions = ['event_type IN (\'stop\', \'interim-update\')', 'DATE(event_at) >= ?', 'DATE(event_at) <= ?'];
    const params = [from, to];

    if (client_id) { conditions.push('client_id = ?'); params.push(client_id); }
    if (contract_id) { conditions.push('contract_id = ?'); params.push(contract_id); }

    const where = conditions.join(' AND ');
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const safeOffset = (Math.max(1, parseInt(page, 10) || 1) - 1) * safeLimit;

    const [rows] = await db.query(
      `SELECT
         DATE(event_at)          AS usage_date,
         client_id,
         contract_id,
         username,
         COUNT(*)                AS session_count,
         COALESCE(SUM(bytes_in),  0) AS bytes_in,
         COALESCE(SUM(bytes_out), 0) AS bytes_out,
         COALESCE(SUM(bytes_in + bytes_out), 0) AS bytes_total,
         COALESCE(SUM(session_duration), 0) AS duration_seconds
       FROM connection_logs
        WHERE ${where} AND ? >= 0 AND ? >= 0
        GROUP BY DATE(event_at), client_id, contract_id, username
        ORDER BY usage_date DESC, bytes_total DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [...params, safeLimit, safeOffset],
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT 1
         FROM connection_logs
         WHERE ${where}
         GROUP BY DATE(event_at), client_id, contract_id, username
       ) sub`,
      params,
    );

    res.json({
      data: rows,
      meta: {
        total: countResult[0].total,
        page: Math.max(1, parseInt(page, 10) || 1),
        limit: safeLimit,
        date_from: from,
        date_to: to,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /top-consumers — top N clients by data usage in a period
router.get('/top-consumers', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const { date_from, date_to, limit = 10 } = req.query;

    const defaultTo = new Date();
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);

    const from = date_from || defaultFrom.toISOString().slice(0, 10);
    const to = date_to || defaultTo.toISOString().slice(0, 10);

    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 10), 100);
    const [rows] = await db.query(
      `SELECT
         client_id,
         contract_id,
         username,
         COUNT(DISTINCT DATE(event_at))           AS active_days,
         COUNT(*)                                  AS session_count,
         COALESCE(SUM(bytes_in),  0)               AS bytes_in,
         COALESCE(SUM(bytes_out), 0)               AS bytes_out,
         COALESCE(SUM(bytes_in + bytes_out), 0)    AS bytes_total,
         COALESCE(SUM(session_duration), 0)        AS duration_seconds
       FROM connection_logs
       WHERE event_type IN ('stop', 'interim-update')
         AND DATE(event_at) >= ?
         AND DATE(event_at) <= ?
         AND ? >= 0
       GROUP BY client_id, contract_id, username
       ORDER BY bytes_total DESC
       LIMIT ${safeLimit}`,
      [from, to, safeLimit],
    );

    res.json({
      data: rows,
      meta: { date_from: from, date_to: to, limit: safeLimit },
    });
  } catch (err) {
    next(err);
  }
});

// List connection logs with filters
router.get('/', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const {
      contract_id, client_id, ip_address, event_type,
      date_from, date_to, page = 1, limit = 50,
    } = req.query;

    const conditions = [];
    const params = [];

    if (contract_id) { conditions.push('contract_id = ?'); params.push(contract_id); }
    if (client_id) { conditions.push('client_id = ?'); params.push(client_id); }
    if (ip_address) { conditions.push('ip_address = ?'); params.push(ip_address); }
    if (event_type) { conditions.push('event_type = ?'); params.push(event_type); }
    if (date_from) { conditions.push('event_at >= ?'); params.push(date_from); }
    if (date_to) { conditions.push('event_at <= ?'); params.push(date_to); }

    const where = conditions.length ? conditions.join(' AND ') : '1=1';
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const safeOffset = (Math.max(1, parseInt(page, 10) || 1) - 1) * safeLimit;

    const [rows] = await db.query(
      `SELECT * FROM connection_logs WHERE ${where} AND ? >= 0 AND ? >= 0 ORDER BY event_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [...params, safeLimit, safeOffset],
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM connection_logs WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: Math.max(1, parseInt(page, 10) || 1), limit: safeLimit } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
