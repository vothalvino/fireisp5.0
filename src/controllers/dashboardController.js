// =============================================================================
// FireISP 5.0 — Dashboard Controller
// =============================================================================
// Aggregated metrics, revenue, device health, and operational KPIs.
// =============================================================================

const db = require('../config/database');
const { aggregateThroughput } = require('../services/throughputService');

// Network-throughput ranges → SNMP lookback window + number of chart buckets.
const THROUGHPUT_RANGES = {
  '1H': { hours: 1, buckets: 60 },
  '6H': { hours: 6, buckets: 72 },
  '24H': { hours: 24, buckets: 96 },
  '7D': { hours: 168, buckets: 84 },
};

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
      db.queryReplica(
        'SELECT COUNT(*) AS total, SUM(status = \'active\') AS active FROM clients WHERE organization_id = ?',
        [orgId],
      ),
      db.queryReplica(
        'SELECT COUNT(*) AS total, SUM(status = \'active\') AS active, SUM(status = \'suspended\') AS suspended FROM contracts WHERE organization_id = ?',
        [orgId],
      ),
      db.queryReplica(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('issued', 'sent', 'overdue') THEN total ELSE 0 END), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) AS collected,
           COALESCE(SUM(CASE WHEN status NOT IN ('draft', 'void', 'cancelled') THEN total ELSE 0 END), 0) AS total_invoiced
         FROM invoices
         WHERE organization_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [orgId],
      ),
      db.queryReplica(
        'SELECT COUNT(*) AS total, SUM(status = \'open\') AS open_count FROM tickets WHERE organization_id = ?',
        [orgId],
      ),
      db.queryReplica(
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
    const [rows] = await db.queryReplica(
      `SELECT
         DATE_FORMAT(created_at, '%Y-%m') AS month,
         currency,
         COALESCE(SUM(CASE WHEN status NOT IN ('draft', 'void', 'cancelled') THEN total ELSE 0 END), 0) AS invoiced,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) AS collected,
         COUNT(CASE WHEN status NOT IN ('draft', 'void', 'cancelled') THEN 1 END) AS invoice_count
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
    const [rows] = await db.queryReplica(
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
    const [devices] = await db.queryReplica(
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
    const [health] = await db.queryReplica(
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
    const [rows] = await db.queryReplica(
      `SELECT i.id, i.invoice_number, i.total, i.currency, i.due_date,
              i.client_id,
              SUBSTRING_INDEX(cl.name, ' ', 1) AS first_name,
              CASE
                WHEN LOCATE(' ', cl.name) > 0 THEN SUBSTRING(cl.name, LOCATE(' ', cl.name) + 1)
                ELSE ''
              END AS last_name,
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

/**
 * GET /api/dashboard/throughput?range=1H|6H|24H|7D
 * Org-wide network throughput derived from SNMP interface octet counters.
 * Returns bucketed in/out bit-rate points + peak/avg/p95 Gbps. `has_data` is
 * false when no SNMP telemetry exists yet (the console then shows an empty
 * state instead of a chart).
 */
async function throughput(req, res, next) {
  try {
    const range = THROUGHPUT_RANGES[req.query.range] ? req.query.range : '24H';
    const cfg = THROUGHPUT_RANGES[range];

    const [rows] = await db.queryReplica(
      `SELECT CONCAT(m.device_id, ':', m.interface_id) AS iface,
              UNIX_TIMESTAMP(m.polled_at) * 1000 AS t,
              m.if_in_octets  AS inO,
              m.if_out_octets AS outO
       FROM snmp_metrics m
       JOIN devices d ON d.id = m.device_id
       WHERE d.organization_id = ?
         AND d.deleted_at IS NULL
         AND m.interface_id IS NOT NULL
         AND m.if_in_octets IS NOT NULL
         AND m.if_out_octets IS NOT NULL
         AND m.polled_at >= NOW() - INTERVAL ? HOUR
       ORDER BY m.polled_at DESC
       LIMIT 50000`,
      [req.orgId, cfg.hours],
    );
    // Cap favors the most recent rows (DESC); the aggregator re-sorts per
    // interface. Very large orgs on wide ranges may see only the most recent
    // window until SQL-side rollup aggregation is added.

    const now = Date.now();
    const samples = rows.map((r) => ({
      iface: r.iface,
      t: Number(r.t),
      inO: Number(r.inO),
      outO: Number(r.outO),
    }));

    const result = aggregateThroughput(samples, {
      fromMs: now - cfg.hours * 3600 * 1000,
      toMs: now,
      buckets: cfg.buckets,
    });

    res.json({ data: { range, ...result } });
  } catch (err) {
    next(err);
  }
}

module.exports = { summary, revenue, mrr, deviceHealth, overdue, throughput };
