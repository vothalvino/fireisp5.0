// =============================================================================
// FireISP 5.0 — Connection Log Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// GET /active — live PPPoE sessions (start events with no corresponding stop)
router.get('/active', requirePermission('connection_logs.view'), async (req, res, next) => {
  try {
    const { username, ip_address, nas_ip_address, page = 1, limit = 50 } = req.query;

    // All user-supplied values go exclusively into parameterized placeholders.
    // The conditions array contains only hardcoded SQL fragments; no user input
    // is ever interpolated into the query string.
    const conditions = [];
    const params = [];

    if (username) { conditions.push('cl.username LIKE ?'); params.push(`%${username}%`); }
    if (ip_address) { conditions.push('cl.ip_address LIKE ?'); params.push(`%${ip_address}%`); }
    if (nas_ip_address) { conditions.push('cl.nas_ip_address = ?'); params.push(nas_ip_address); }

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
