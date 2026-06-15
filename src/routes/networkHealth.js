// =============================================================================
// FireISP 5.0 — Network Health Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// List network health snapshots with filters
router.get('/', requirePermission('network_health.view'), async (req, res, next) => {
  try {
    const {
      device_id, network_link_id, date_from, date_to,
      page = 1, limit = 50,
    } = req.query;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (device_id) { conditions.push('device_id = ?'); params.push(device_id); }
    if (network_link_id) { conditions.push('network_link_id = ?'); params.push(network_link_id); }
    if (date_from) { conditions.push('snapshot_date >= ?'); params.push(date_from); }
    if (date_to) { conditions.push('snapshot_date <= ?'); params.push(date_to); }

    const where = conditions.length ? conditions.join(' AND ') : '1=1';
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (Math.max(1, parseInt(page, 10) || 1) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM network_health_snapshots WHERE ${where} ORDER BY snapshot_date DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM network_health_snapshots WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
