// =============================================================================
// FireISP 5.0 — Revenue Summary Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// List revenue summaries with filters
router.get('/', requirePermission('revenue_summary.view'), async (req, res, next) => {
  try {
    const {
      period_date, currency, page = 1, limit = 50,
    } = req.query;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (period_date) { conditions.push('period_date = ?'); params.push(period_date); }
    if (currency) { conditions.push('currency = ?'); params.push(currency); }

    const where = conditions.join(' AND ');
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      `SELECT * FROM revenue_summary WHERE ${where} ORDER BY period_date DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset],
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM revenue_summary WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
