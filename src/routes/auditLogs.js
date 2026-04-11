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
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset],
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

module.exports = router;
