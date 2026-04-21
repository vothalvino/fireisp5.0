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

    const conditions = [];
    const params = [];

    if (username) { conditions.push('cl.username LIKE ?'); params.push(`%${username}%`); }
    if (ip_address) { conditions.push('cl.ip_address LIKE ?'); params.push(`%${ip_address}%`); }
    if (nas_ip_address) { conditions.push('cl.nas_ip_address = ?'); params.push(nas_ip_address); }

    const extraWhere = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const sql = `
      SELECT cl.*
      FROM connection_logs cl
      WHERE cl.event_type = 'start'
        AND NOT EXISTS (
          SELECT 1 FROM connection_logs cl2
          WHERE cl2.session_id = cl.session_id
            AND cl2.contract_id = cl.contract_id
            AND cl2.event_type = 'stop'
        )
        ${extraWhere}
      ORDER BY cl.event_at DESC
      LIMIT ? OFFSET ?
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
        ${extraWhere}
    `;

    const [rows] = await db.query(sql, [...params, parseInt(limit, 10), offset]);
    const [countResult] = await db.query(countSql, params);

    res.json({
      data: rows,
      meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) },
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
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      `SELECT * FROM connection_logs WHERE ${where} ORDER BY event_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset],
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM connection_logs WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
