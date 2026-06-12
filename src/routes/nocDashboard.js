// =============================================================================
// FireISP 5.0 — NOC Dashboard Routes — §12.2
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// GET /noc/health — network health rollup
router.get('/health', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [[deviceStats]] = await db.query(
      `SELECT
         COUNT(*) AS total_devices,
         SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down,
         SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) AS warning
       FROM devices
       WHERE organization_id = ? AND deleted_at IS NULL`,
      [req.orgId],
    );
    const [alertStats] = await db.query(
      `SELECT severity, COUNT(*) AS count
       FROM alert_events
       WHERE organization_id = ? AND resolved_at IS NULL
       GROUP BY severity`,
      [req.orgId],
    );
    res.json({
      data: {
        devices: deviceStats,
        active_alerts: alertStats,
      },
    });
  } catch (err) { next(err); }
});

// GET /noc/alarms — active alarm counts by severity
router.get('/alarms', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT severity, COUNT(*) AS count
       FROM alert_events
       WHERE organization_id = ? AND resolved_at IS NULL
       GROUP BY severity
       ORDER BY FIELD(severity, 'critical','high','medium','low','info')`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /noc/outages — ongoing outages grouped by site
// Note: outages table has no organization_id; filter via sites join
router.get('/outages', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT o.*, s.name AS site_name
       FROM outages o
       LEFT JOIN sites s ON s.id = o.site_id
       WHERE s.organization_id = ? AND o.status = 'ongoing' AND o.deleted_at IS NULL
       ORDER BY o.started_at DESC`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /noc/ticket-queue — open tickets by priority with SLA info
router.get('/ticket-queue', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT
         t.id, t.subject, t.priority, t.status, t.created_at,
         u.first_name AS assigned_first, u.last_name AS assigned_last
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.organization_id = ?
         AND t.status IN ('open','in_progress','waiting')
         AND t.deleted_at IS NULL
       ORDER BY FIELD(t.priority,'critical','high','medium','low'), t.created_at ASC
       LIMIT 100`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /noc/events — recent 50 events timeline
router.get('/events', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [alertEvents] = await db.query(
      `SELECT 'alert' AS event_type, id, metric AS detail, severity, created_at AS occurred_at
       FROM alert_events
       WHERE organization_id = ?
       ORDER BY created_at DESC LIMIT 20`,
      [req.orgId],
    );
    const [outageEvents] = await db.query(
      `SELECT 'outage' AS event_type, o.id, o.title AS detail, o.status, o.started_at AS occurred_at
       FROM outages o
       LEFT JOIN sites s ON s.id = o.site_id
       WHERE s.organization_id = ? AND o.deleted_at IS NULL
       ORDER BY o.started_at DESC LIMIT 20`,
      [req.orgId],
    );
    const [ticketEvents] = await db.query(
      `SELECT 'ticket' AS event_type, id, subject AS detail, status, created_at AS occurred_at
       FROM tickets
       WHERE organization_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 20`,
      [req.orgId],
    );
    const combined = [...alertEvents, ...outageEvents, ...ticketEvents]
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
      .slice(0, 50);
    res.json({ data: combined });
  } catch (err) { next(err); }
});

// GET /noc/sla-compliance — SLA compliance % for current 30-day period
// ticket_sla_events uses is_breached TINYINT (0=compliant, 1=breached)
router.get('/sla-compliance', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [[stats]] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN tse.is_breached = 0 THEN 1 ELSE 0 END) AS compliant
       FROM ticket_sla_events tse
       JOIN tickets t ON t.id = tse.ticket_id
       WHERE t.organization_id = ? AND tse.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [req.orgId],
    );
    const total = Number(stats.total) || 0;
    const compliant = Number(stats.compliant) || 0;
    const pct = total > 0 ? Math.round((compliant / total) * 100) : 100;
    res.json({ data: { total, compliant, non_compliant: total - compliant, compliance_pct: pct } });
  } catch (err) { next(err); }
});

module.exports = router;
