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
// devices.status ENUM is ('online','offline','maintenance'); alert severity
// lives on alert_rules (alert_events has no severity column).
router.get('/health', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [[deviceStats]] = await db.query(
      `SELECT
         COUNT(*) AS devices_total,
         SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS devices_up,
         SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS devices_down,
         SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS devices_maintenance
       FROM devices
       WHERE organization_id = ? AND deleted_at IS NULL`,
      [req.orgId],
    );
    const [alertStats] = await db.query(
      `SELECT ar.severity, COUNT(*) AS count
       FROM alert_events ae
       JOIN alert_rules ar ON ar.id = ae.alert_rule_id
       WHERE ae.organization_id = ? AND ae.resolved_at IS NULL
       GROUP BY ar.severity`,
      [req.orgId],
    );
    const total = Number(deviceStats.devices_total) || 0;
    const up = Number(deviceStats.devices_up) || 0;
    res.json({
      data: {
        devices_total: total,
        devices_up: up,
        devices_down: Number(deviceStats.devices_down) || 0,
        devices_maintenance: Number(deviceStats.devices_maintenance) || 0,
        uptime_pct: total > 0 ? Math.round((up / total) * 1000) / 10 : null,
        active_alerts: alertStats,
      },
    });
  } catch (err) { next(err); }
});

// GET /noc/alarms — active alarm counts by severity
// severity lives on alert_rules; ENUM is ('info','warning','major','critical').
router.get('/alarms', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT ar.severity, COUNT(*) AS count
       FROM alert_events ae
       JOIN alert_rules ar ON ar.id = ae.alert_rule_id
       WHERE ae.organization_id = ? AND ae.resolved_at IS NULL
       GROUP BY ar.severity
       ORDER BY FIELD(ar.severity, 'critical','major','warning','info')`,
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

// GET /noc/ticket-queue — open tickets by status with counts
router.get('/ticket-queue', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT t.status, COUNT(*) AS count
       FROM tickets t
       WHERE t.organization_id = ?
         AND t.status IN ('open','in_progress','waiting')
         AND t.deleted_at IS NULL
       GROUP BY t.status
       ORDER BY FIELD(t.status,'open','in_progress','waiting')`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /noc/events — recent 50 events timeline
router.get('/events', requirePermission('noc.view'), async (req, res, next) => {
  try {
    const [alertEvents] = await db.query(
      `SELECT 'alert' AS event_type, ae.id, ae.metric AS detail, ar.severity, ae.created_at AS occurred_at
       FROM alert_events ae
       JOIN alert_rules ar ON ar.id = ae.alert_rule_id
       WHERE ae.organization_id = ?
       ORDER BY ae.created_at DESC LIMIT 20`,
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
