// =============================================================================
// FireISP 5.0 — Poller Performance Routes (§6.4)
// =============================================================================
//
// GET    /poller-performance              — list snapshots (paginated)
// GET    /poller-performance/dashboard    — aggregated stats across all nodes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');
const pollerEngine = require('../services/pollerEngine');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// GET /poller-performance/dashboard — aggregated stats across all nodes
// Must be defined before /:id to avoid route shadowing.
// ---------------------------------------------------------------------------
router.get('/dashboard', requirePermission('poller_performance.view'), async (req, res, next) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const rows = await pollerEngine.getPerformanceDashboard(null, hours);

    // Aggregate across all nodes
    let totalPolled = 0;
    let totalFailed = 0;
    let maxDuration = 0;
    let durationSum = 0;
    let durationCount = 0;

    for (const r of rows) {
      totalPolled += r.devices_polled || 0;
      totalFailed += r.devices_failed || 0;
      if (r.max_poll_duration_ms) maxDuration = Math.max(maxDuration, r.max_poll_duration_ms);
      if (r.avg_poll_duration_ms !== null && r.avg_poll_duration_ms !== undefined) {
        durationSum += r.avg_poll_duration_ms;
        durationCount++;
      }
    }

    const avgDuration = durationCount > 0 ? Math.round(durationSum / durationCount) : null;
    const timeoutRate = totalPolled > 0
      ? parseFloat(((totalFailed / totalPolled) * 100).toFixed(2))
      : null;

    res.json({
      data: {
        hours,
        total_snapshots: rows.length,
        total_devices_polled: totalPolled,
        total_devices_failed: totalFailed,
        avg_poll_duration_ms: avgDuration,
        max_poll_duration_ms: maxDuration || null,
        timeout_rate_pct: timeoutRate,
      },
      snapshots: rows.slice(0, 100),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /poller-performance — list snapshots (paginated)
// ---------------------------------------------------------------------------
router.get('/', requirePermission('poller_performance.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const hours = parseInt(req.query.hours, 10) || 24;
    const nodeId = req.query.node_id ? parseInt(req.query.node_id, 10) : null;

    const conditions = ['pps.snapshot_at >= NOW() - INTERVAL ? HOUR'];
    const countParams = [hours];
    const params = [hours];

    if (nodeId) {
      conditions.push('pps.poller_node_id = ?');
      countParams.push(nodeId);
      params.push(nodeId);
    }

    const where = conditions.join(' AND ');

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM poller_performance_snapshots pps
       WHERE ${where}`,
      countParams,
    );

    params.push(limit, offset);
    const [rows] = await db.query(
      `SELECT pps.id, pps.poller_node_id, pn.name AS node_name,
              pps.snapshot_at, pps.devices_polled, pps.devices_failed,
              pps.avg_poll_duration_ms, pps.max_poll_duration_ms,
              pps.queue_depth, pps.timeout_rate_pct
       FROM poller_performance_snapshots pps
       LEFT JOIN poller_nodes pn ON pn.id = pps.poller_node_id
       WHERE ${where}
       ORDER BY pps.snapshot_at DESC
       LIMIT ? OFFSET ?`,
      params,
    );

    res.json({
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
