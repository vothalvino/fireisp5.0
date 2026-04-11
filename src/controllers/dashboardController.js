// =============================================================================
// FireISP 5.0 — Dashboard Controller
// =============================================================================
// Aggregated metrics, revenue, device health, and operational KPIs.
// =============================================================================

const db = require('../config/database');

/**
 * GET /api/dashboard/summary
 * High-level KPI overview for the current organization.
 */
async function summary(req, res, next) {
  try {
    const orgId = req.orgId;

    const [
      [clientsResult],
      [contractsResult],
      [revenueResult],
      [ticketsResult],
      [devicesResult],
    ] = await Promise.all([
      db.query(
        'SELECT COUNT(*) AS total, SUM(status = \'active\') AS active FROM clients WHERE organization_id = ?',
        [orgId],
      ),
      db.query(
        'SELECT COUNT(*) AS total, SUM(status = \'active\') AS active, SUM(status = \'suspended\') AS suspended FROM contracts WHERE organization_id = ?',
        [orgId],
      ),
      db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'issued' THEN total ELSE 0 END), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) AS collected,
           COALESCE(SUM(total), 0) AS total_invoiced
         FROM invoices
         WHERE organization_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [orgId],
      ),
      db.query(
        'SELECT COUNT(*) AS total, SUM(status = \'open\') AS open_count FROM tickets WHERE organization_id = ?',
        [orgId],
      ),
      db.query(
        'SELECT COUNT(*) AS total, SUM(snmp_enabled = 1) AS monitored FROM devices WHERE organization_id = ?',
        [orgId],
      ),
    ]);

    res.json({
      data: {
        clients: clientsResult[0],
        contracts: contractsResult[0],
        revenue_30d: revenueResult[0],
        tickets: ticketsResult[0],
        devices: devicesResult[0],
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/revenue
 * Monthly revenue breakdown (last 12 months).
 */
async function revenue(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT
         DATE_FORMAT(created_at, '%Y-%m') AS month,
         currency,
         COALESCE(SUM(total), 0) AS invoiced,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) AS collected,
         COUNT(*) AS invoice_count
       FROM invoices
       WHERE organization_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month, currency
       ORDER BY month DESC`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/mrr
 * Monthly Recurring Revenue and ARPU based on active contracts.
 */
async function mrr(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT
         p.currency,
         COUNT(c.id) AS active_contracts,
         COALESCE(SUM(COALESCE(c.price_override, p.price)), 0) AS mrr,
         ROUND(COALESCE(SUM(COALESCE(c.price_override, p.price)), 0) / NULLIF(COUNT(DISTINCT c.client_id), 0), 2) AS arpu
       FROM contracts c
       JOIN plans p ON p.id = c.plan_id
       WHERE c.organization_id = ? AND c.status = 'active'
       GROUP BY p.currency`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/device-health
 * Device health overview — uptime, alerts, and monitored count.
 */
async function deviceHealth(req, res, next) {
  try {
    const [devices] = await db.query(
      `SELECT
         d.type,
         COUNT(*) AS total,
         SUM(d.snmp_enabled = 1) AS monitored,
         SUM(d.status = 'active') AS active
       FROM devices d
       WHERE d.organization_id = ?
       GROUP BY d.type`,
      [req.orgId],
    );

    // Latest network health snapshots (last 7 days)
    const [health] = await db.query(
      `SELECT
         snapshot_date,
         COUNT(*) AS device_count,
         ROUND(AVG(uptime_pct), 2) AS avg_uptime,
         ROUND(AVG(avg_latency_ms), 2) AS avg_latency,
         ROUND(AVG(packet_loss_pct), 2) AS avg_packet_loss
       FROM network_health_snapshots
       WHERE organization_id = ? AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       GROUP BY snapshot_date
       ORDER BY snapshot_date DESC`,
      [req.orgId],
    );

    res.json({ data: { devices_by_type: devices, health_snapshots: health } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/overdue
 * List overdue invoices with days past due.
 */
async function overdue(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT i.id, i.invoice_number, i.total, i.currency, i.due_date,
              i.client_id, cl.first_name, cl.last_name,
              DATEDIFF(NOW(), i.due_date) AS days_overdue
       FROM invoices i
       JOIN clients cl ON cl.id = i.client_id
       WHERE i.organization_id = ?
         AND i.status = 'issued'
         AND i.due_date < NOW()
       ORDER BY days_overdue DESC
       LIMIT 100`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { summary, revenue, mrr, deviceHealth, overdue };
