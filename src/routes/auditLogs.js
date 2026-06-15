// =============================================================================
// FireISP 5.0 — Audit Log Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// List audit logs with filters
router.get('/', requirePermission('audit_logs.view'), async (req, res, next) => {
  try {
    const {
      user_id, action, table_name, date_from, date_to,
      page = 1, limit = 50,
    } = req.query;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (user_id) { conditions.push('user_id = ?'); params.push(user_id); }
    if (action) { conditions.push('action = ?'); params.push(action); }
    if (table_name) { conditions.push('table_name = ?'); params.push(table_name); }
    if (date_from) { conditions.push('created_at >= ?'); params.push(date_from); }
    if (date_to) { conditions.push('created_at <= ?'); params.push(date_to); }

    const where = conditions.join(' AND ');
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (Math.max(1, parseInt(page, 10) || 1) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

// Export audit logs for regulatory inspection (no pagination — up to 10000 rows)
router.get('/export', requirePermission('audit_export.view'), async (req, res, next) => {
  try {
    const { date_from, date_to, action, entity_type } = req.query;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (action) { conditions.push('action = ?'); params.push(action); }
    if (entity_type) { conditions.push('table_name = ?'); params.push(entity_type); }
    if (date_from) { conditions.push('created_at >= ?'); params.push(date_from); }
    if (date_to) { conditions.push('created_at <= ?'); params.push(date_to); }

    const where = conditions.join(' AND ');

    const [rows] = await db.query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT 10000`,
      params,
    );

    // Log to report_access_logs
    await db.query(
      `INSERT INTO report_access_logs (organization_id, user_id, report_type, entity_type, parameters, ip_address, user_agent, accessed_at)
       VALUES (?, ?, 'audit_export', 'audit_logs', ?, ?, ?, NOW())`,
      [req.orgId, req.user.id, JSON.stringify(req.query), req.ip || null, req.get('user-agent') || null],
    );

    res.json({
      data: rows,
      meta: {
        total: rows.length,
        exported_at: new Date().toISOString(),
        exported_by: req.user.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

// List report access logs
router.get('/report-access-logs', requirePermission('report_access_logs.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (Math.max(1, parseInt(page, 10) || 1) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM report_access_logs WHERE organization_id = ? ORDER BY accessed_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM report_access_logs WHERE organization_id = ?',
      [req.orgId],
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
