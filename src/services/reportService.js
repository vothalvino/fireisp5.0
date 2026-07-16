// =============================================================================
// FireISP 5.0 — Report Generation Service
// =============================================================================
// Generates business reports: aging (AR), financial summary, technician
// productivity, and subscriber growth. Returns structured data suitable
// for JSON API responses, CSV export, or PDF rendering.
// =============================================================================

const db = require('../config/database');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultFrom() {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

// =============================================================================
// §14 — Original 4 functions (preserved exactly)
// =============================================================================

/**
 * Accounts Receivable Aging Report — groups unpaid invoices by age buckets.
 */
async function agingReport(organizationId, { currency } = {}) {
  let sql = `
    SELECT
      i.client_id,
      c.name, c.email,
      i.id AS invoice_id,
      i.invoice_number,
      i.total,
      i.currency,
      i.due_date,
      DATEDIFF(NOW(), i.due_date) AS days_overdue,
      CASE
        WHEN DATEDIFF(NOW(), i.due_date) <= 0 THEN 'current'
        WHEN DATEDIFF(NOW(), i.due_date) BETWEEN 1 AND 30 THEN '1-30'
        WHEN DATEDIFF(NOW(), i.due_date) BETWEEN 31 AND 60 THEN '31-60'
        WHEN DATEDIFF(NOW(), i.due_date) BETWEEN 61 AND 90 THEN '61-90'
        ELSE '90+'
      END AS aging_bucket
    FROM \`invoices\` i
    JOIN \`clients\` c ON c.id = i.client_id
    WHERE i.organization_id = ? AND i.status IN ('issued', 'sent', 'overdue')
  `;
  const params = [organizationId];

  if (currency) {
    sql += ' AND i.currency = ?';
    params.push(currency);
  }

  sql += ' ORDER BY days_overdue DESC';
  const [rows] = await db.queryReplica(sql, params);

  // Aggregate by bucket
  const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const row of rows) {
    buckets[row.aging_bucket] += parseFloat(row.total);
  }

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    summary: buckets,
    total_outstanding: Object.values(buckets).reduce((a, b) => a + b, 0),
    invoice_count: rows.length,
    details: rows,
  };
}

/**
 * Financial Summary — revenue, collections, expenses for a period.
 */
async function financialSummary(organizationId, { from, to, currency } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const currencyFilter = currency ? 'AND currency = ?' : '';
  const baseParams = currency ? [organizationId, dateFrom, dateTo, currency] : [organizationId, dateFrom, dateTo];

  const [[invoiceRows], [paymentRows], [expenseRows]] = await Promise.all([
    db.queryReplica(`
      SELECT
        COALESCE(SUM(CASE WHEN status NOT IN ('draft', 'void', 'cancelled') THEN total ELSE 0 END), 0) AS total_invoiced,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN status IN ('issued', 'sent', 'overdue') THEN total ELSE 0 END), 0) AS total_outstanding,
        COUNT(CASE WHEN status NOT IN ('draft', 'void', 'cancelled') THEN 1 END) AS invoice_count
      FROM \`invoices\`
      WHERE organization_id = ? AND created_at >= ? AND created_at <= ? ${currencyFilter}
    `, baseParams),
    db.queryReplica(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_payments,
        COUNT(*) AS payment_count
      FROM \`payments\`
      WHERE organization_id = ? AND created_at >= ? AND created_at <= ? ${currencyFilter}
    `, baseParams),
    db.queryReplica(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_expenses,
        COUNT(*) AS expense_count
      FROM \`expenses\`
      WHERE organization_id = ? AND created_at >= ? AND created_at <= ? ${currencyFilter}
    `, baseParams),
  ]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    revenue: {
      invoiced: parseFloat(invoiceRows[0].total_invoiced),
      collected: parseFloat(invoiceRows[0].total_collected),
      outstanding: parseFloat(invoiceRows[0].total_outstanding),
      invoice_count: invoiceRows[0].invoice_count,
    },
    payments: {
      total: parseFloat(paymentRows[0].total_payments),
      count: paymentRows[0].payment_count,
    },
    expenses: {
      total: parseFloat(expenseRows[0].total_expenses),
      count: expenseRows[0].expense_count,
    },
    net_income: parseFloat(paymentRows[0].total_payments) - parseFloat(expenseRows[0].total_expenses),
  };
}

/**
 * Technician Productivity Report — jobs completed, average time, by user.
 */
async function technicianReport(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  // `jobs` was consolidated into `work_orders` (migration 363) — it has a
  // dedicated `completed_at` column, which is a more accurate completion-time
  // signal than `updated_at` (which any unrelated edit would also bump).
  const [rows] = await db.queryReplica(`
    SELECT
      j.assigned_to AS user_id,
      u.first_name, u.last_name,
      COUNT(*) AS total_jobs,
      SUM(j.status = 'completed') AS completed,
      SUM(j.status = 'cancelled') AS cancelled,
      SUM(j.status IN ('pending', 'in_progress')) AS in_progress,
      ROUND(AVG(CASE WHEN j.status = 'completed' THEN TIMESTAMPDIFF(HOUR, j.created_at, j.completed_at) END), 1) AS avg_completion_hours
    FROM \`work_orders\` j
    LEFT JOIN \`users\` u ON u.id = j.assigned_to
    WHERE j.organization_id = ?
      AND j.created_at >= ? AND j.created_at <= ?
    GROUP BY j.assigned_to, u.first_name, u.last_name
    ORDER BY completed DESC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    technicians: rows,
  };
}

/**
 * Subscriber Growth Report — new/churned contracts per month.
 */
async function subscriberGrowthReport(organizationId, { months = 12 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(c.created_at, '%Y-%m') AS month,
      SUM(c.status IN ('active', 'suspended')) AS new_contracts,
      SUM(c.status = 'cancelled') AS churned
    FROM \`contracts\` c
    WHERE c.organization_id = ?
      AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
    GROUP BY month
    ORDER BY month DESC
  `, [organizationId, months]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    months: rows,
  };
}

// =============================================================================
// §15.1 — Financial Reports
// =============================================================================

/**
 * Revenue by Period — aggregate invoices grouped by daily/weekly/monthly/quarterly/annually.
 */
async function revenueByPeriod(organizationId, { period = 'monthly', from, to, currency } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  let periodExpr;
  switch (period) {
    case 'daily':
      periodExpr = "DATE_FORMAT(i.issue_date, '%Y-%m-%d')";
      break;
    case 'weekly':
      periodExpr = "CONCAT(YEAR(i.issue_date), '-W', LPAD(WEEK(i.issue_date, 3), 2, '0'))";
      break;
    case 'quarterly':
      periodExpr = "CONCAT(YEAR(i.issue_date), 'Q', QUARTER(i.issue_date))";
      break;
    case 'annually':
      periodExpr = 'CAST(YEAR(i.issue_date) AS CHAR)';
      break;
    default:
      periodExpr = "DATE_FORMAT(i.issue_date, '%Y-%m')";
  }

  const params = [organizationId, dateFrom, dateTo];
  let currencyFilter = '';
  if (currency) {
    currencyFilter = 'AND i.currency = ?';
    params.push(currency);
  }

  const [rows] = await db.queryReplica(`
    SELECT
      ${periodExpr} AS period_label,
      COALESCE(SUM(i.total), 0) AS total_invoiced,
      COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END), 0) AS total_collected,
      COALESCE(SUM(CASE WHEN i.status IN ('issued', 'sent', 'overdue') THEN i.total ELSE 0 END), 0) AS total_outstanding,
      COUNT(*) AS invoice_count
    FROM \`invoices\` i
    WHERE i.organization_id = ?
      AND i.issue_date >= ? AND i.issue_date <= ?
      AND i.status NOT IN ('draft', 'void', 'cancelled')
      ${currencyFilter}
    GROUP BY period_label
    ORDER BY period_label ASC
  `, params);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period,
    rows,
  };
}

/**
 * Revenue by Plan — invoices joined to contracts/plans grouped by plan name.
 */
async function revenueByPlan(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      COALESCE(p.name, 'Unknown') AS plan_name,
      COALESCE(SUM(i.total), 0) AS total_invoiced,
      COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END), 0) AS total_collected,
      COUNT(DISTINCT i.contract_id) AS contract_count
    FROM \`invoices\` i
    LEFT JOIN \`contracts\` co ON co.id = i.contract_id
    LEFT JOIN \`plans\` p ON p.id = co.plan_id
    WHERE i.organization_id = ?
      AND i.issue_date >= ? AND i.issue_date <= ?
      AND i.status NOT IN ('draft', 'void', 'cancelled')
    GROUP BY p.name
    ORDER BY total_invoiced DESC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

/**
 * Revenue by Region — invoices joined to contracts/sites grouped by city.
 */
async function revenueByRegion(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      COALESCE(s.city, 'Unknown') AS region,
      COALESCE(SUM(i.total), 0) AS total_invoiced,
      COUNT(DISTINCT i.contract_id) AS contract_count
    FROM \`invoices\` i
    LEFT JOIN \`contracts\` co ON co.id = i.contract_id
    LEFT JOIN \`sites\` s ON s.id = co.site_id
    WHERE i.organization_id = ?
      AND i.issue_date >= ? AND i.issue_date <= ?
      AND i.status NOT IN ('draft', 'void', 'cancelled')
    GROUP BY s.city
    ORDER BY total_invoiced DESC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

/**
 * Revenue by Agent — invoices grouped by the user who created them.
 */
async function revenueByAgent(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      i.created_by AS user_id,
      u.first_name,
      u.last_name,
      COALESCE(SUM(i.total), 0) AS total_invoiced,
      COUNT(*) AS invoice_count
    FROM \`invoices\` i
    LEFT JOIN \`users\` u ON u.id = i.created_by
    WHERE i.organization_id = ?
      AND i.issue_date >= ? AND i.issue_date <= ?
      AND i.status NOT IN ('draft', 'void', 'cancelled')
    GROUP BY i.created_by, u.first_name, u.last_name
    ORDER BY total_invoiced DESC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

/**
 * Cash Flow Report — monthly inflows (payments) vs outflows (expenses).
 */
async function cashFlowReport(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [[inRows], [outRows]] = await Promise.all([
    db.queryReplica(`
      SELECT
        DATE_FORMAT(payment_date, '%Y-%m') AS month,
        COALESCE(SUM(amount), 0) AS inflow
      FROM \`payments\`
      WHERE organization_id = ?
        AND payment_date >= ? AND payment_date <= ?
      GROUP BY month
      ORDER BY month ASC
    `, [organizationId, dateFrom, dateTo]),
    db.queryReplica(`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        COALESCE(SUM(amount), 0) AS outflow
      FROM \`expenses\`
      WHERE organization_id = ?
        AND created_at >= ? AND created_at <= ?
      GROUP BY month
      ORDER BY month ASC
    `, [organizationId, dateFrom, dateTo]),
  ]);

  // Merge by month
  const monthMap = {};
  for (const r of inRows) {
    monthMap[r.month] = { month: r.month, inflow: parseFloat(r.inflow), outflow: 0 };
  }
  for (const r of outRows) {
    if (!monthMap[r.month]) {
      monthMap[r.month] = { month: r.month, inflow: 0, outflow: 0 };
    }
    monthMap[r.month].outflow = parseFloat(r.outflow);
  }

  const rows = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(r => ({ ...r, net: r.inflow - r.outflow }));

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

/**
 * Payment Method Breakdown — payments grouped by method with percentages.
 */
async function paymentMethodBreakdown(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      payment_method AS method,
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS total
    FROM \`payments\`
    WHERE organization_id = ?
      AND payment_date >= ? AND payment_date <= ?
    GROUP BY payment_method
    ORDER BY total DESC
  `, [organizationId, dateFrom, dateTo]);

  const grandTotal = rows.reduce((s, r) => s + parseFloat(r.total), 0);
  const enriched = rows.map(r => ({
    method: r.method,
    count: r.count,
    total: parseFloat(r.total),
    pct: grandTotal > 0 ? parseFloat(((parseFloat(r.total) / grandTotal) * 100).toFixed(2)) : 0,
  }));

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows: enriched,
  };
}

/**
 * Churn Revenue Impact — churned contracts and estimated MRR lost from revenue_summary.
 */
async function churnRevenueImpact(organizationId, { months = 12 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(period_date, '%Y-%m-%d') AS period_date,
      churned_contracts,
      ROUND(
        churned_contracts * (total_mrr / NULLIF(total_contracts_active, 0)),
        2
      ) AS estimated_mrr_lost
    FROM \`revenue_summary\`
    WHERE organization_id = ?
      AND period_date >= DATE_SUB(NOW(), INTERVAL ? MONTH)
    ORDER BY period_date ASC
  `, [organizationId, months]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * Agent Commissions — total invoiced and commission per agent for a period.
 */
async function agentCommissions(organizationId, { from, to, rate = 0.05 } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      i.created_by AS user_id,
      u.first_name,
      u.last_name,
      COALESCE(SUM(i.total), 0) AS total_invoiced,
      ROUND(COALESCE(SUM(i.total), 0) * ?, 2) AS commission
    FROM \`invoices\` i
    LEFT JOIN \`users\` u ON u.id = i.created_by
    WHERE i.organization_id = ?
      AND i.issue_date >= ? AND i.issue_date <= ?
      AND i.status NOT IN ('draft', 'void', 'cancelled')
    GROUP BY i.created_by, u.first_name, u.last_name
    ORDER BY total_invoiced DESC
  `, [rate, organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rate,
    rows,
  };
}

/**
 * Tax Summary — totals and breakdown by tax rate from invoices.
 */
async function taxSummary(organizationId, { from, to, currency } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const params = [organizationId, dateFrom, dateTo];
  let currencyFilter = '';
  if (currency) {
    currencyFilter = 'AND currency = ?';
    params.push(currency);
  }

  const [[summaryRows], [byRateRows]] = await Promise.all([
    db.queryReplica(`
      SELECT
        COALESCE(SUM(tax_amount), 0) AS total_tax,
        COALESCE(SUM(subtotal), 0) AS total_subtotal,
        COALESCE(SUM(total), 0) AS total_invoiced
      FROM \`invoices\`
      WHERE organization_id = ?
        AND issue_date >= ? AND issue_date <= ?
        AND status NOT IN ('draft', 'void', 'cancelled')
        ${currencyFilter}
    `, params),
    db.queryReplica(`
      SELECT
        tax_rate,
        COUNT(*) AS count,
        COALESCE(SUM(tax_amount), 0) AS total_tax,
        COALESCE(SUM(subtotal), 0) AS total_subtotal
      FROM \`invoices\`
      WHERE organization_id = ?
        AND issue_date >= ? AND issue_date <= ?
        AND status NOT IN ('draft', 'void', 'cancelled')
        ${currencyFilter}
      GROUP BY tax_rate
      ORDER BY tax_rate ASC
    `, params),
  ]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    total_tax: parseFloat(summaryRows[0].total_tax),
    total_subtotal: parseFloat(summaryRows[0].total_subtotal),
    total_invoiced: parseFloat(summaryRows[0].total_invoiced),
    by_rate: byRateRows,
  };
}

/**
 * SAT Export — invoice + client data suitable for SAT (Mexican tax authority) reporting.
 */
async function satExport(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.issue_date,
      i.due_date,
      i.subtotal,
      i.tax_rate,
      i.tax_amount,
      i.total,
      i.currency,
      i.status,
      i.paid_at,
      c.id AS client_id,
      c.name,
      c.email
    FROM \`invoices\` i
    JOIN \`clients\` c ON c.id = i.client_id
    WHERE i.organization_id = ?
      AND i.issue_date >= ? AND i.issue_date <= ?
      AND i.status NOT IN ('draft', 'void')
    ORDER BY i.issue_date ASC, i.invoice_number ASC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

// =============================================================================
// §15.2 — Operational Reports
// =============================================================================

/**
 * Subscriber Counts — contract counts by status grouped by month.
 */
async function subscriberCounts(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m') AS month,
      SUM(status = 'active') AS active,
      SUM(status = 'suspended') AS suspended,
      SUM(status = 'cancelled') AS cancelled
    FROM \`contracts\`
    WHERE organization_id = ?
      AND created_at >= ? AND created_at <= ?
    GROUP BY month
    ORDER BY month ASC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

/**
 * ARPU Report — average revenue per user from revenue_summary.
 */
async function arpuReport(organizationId, { months = 12 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(period_date, '%Y-%m-%d') AS period_date,
      arpu,
      total_mrr,
      total_clients_active,
      currency
    FROM \`revenue_summary\`
    WHERE organization_id = ?
      AND period_date >= DATE_SUB(NOW(), INTERVAL ? MONTH)
    ORDER BY period_date ASC
  `, [organizationId, months]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * Bandwidth Utilization — per-device averages and peaks from snmp_metrics_1day.
 */
async function bandwidthUtilization(organizationId, { days = 30 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      m.device_id,
      d.name AS device_name,
      ROUND(AVG(m.avg_if_in_octets) * 8 / 1000000, 4) AS avg_in_mbps,
      ROUND(AVG(m.avg_if_out_octets) * 8 / 1000000, 4) AS avg_out_mbps,
      ROUND(MAX(m.avg_if_in_octets) * 8 / 1000000, 4) AS peak_in_mbps,
      ROUND(MAX(m.avg_if_out_octets) * 8 / 1000000, 4) AS peak_out_mbps
    FROM \`snmp_metrics_1day\` m
    JOIN \`devices\` d ON d.id = m.device_id
    WHERE d.organization_id = ?
      AND m.period_start >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY m.device_id, d.name
    ORDER BY avg_out_mbps DESC
  `, [organizationId, days]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * Top Consumers — devices with highest total data transfer over a period.
 */
async function topConsumers(organizationId, { days = 30, limit = 10 } = {}) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);
  const [rows] = await db.queryReplica(`
    SELECT
      m.device_id,
      d.name AS device_name,
      ROUND(SUM(m.avg_if_in_octets * m.sample_count) / 1073741824, 4) AS total_in_gb,
      ROUND(SUM(m.avg_if_out_octets * m.sample_count) / 1073741824, 4) AS total_out_gb,
      ROUND(SUM((m.avg_if_in_octets + m.avg_if_out_octets) * m.sample_count) / 1073741824, 4) AS total_gb
    FROM \`snmp_metrics_1day\` m
    JOIN \`devices\` d ON d.id = m.device_id
    WHERE d.organization_id = ?
      AND m.period_start >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY m.device_id, d.name
    ORDER BY total_gb DESC
    LIMIT ${safeLimit}
  `, [organizationId, days]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * Uptime by Area — average uptime and downtime grouped by device type.
 */
async function uptimeByArea(organizationId, { days = 30 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      d.type AS device_type,
      ROUND(AVG(n.uptime_pct), 4) AS avg_uptime_pct,
      SUM(n.total_downtime_minutes) AS total_downtime_minutes,
      COUNT(DISTINCT d.id) AS device_count
    FROM \`network_health_snapshots\` n
    JOIN \`devices\` d ON d.id = n.device_id
    WHERE n.organization_id = ?
      AND n.snapshot_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY d.type
    ORDER BY avg_uptime_pct DESC
  `, [organizationId, days]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * MTTR Report — mean time to resolve work orders, grouped by month.
 */
async function mttrReport(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [[summaryRows], [monthRows]] = await Promise.all([
    db.queryReplica(`
      SELECT
        ROUND(AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)), 2) AS avg_mttr_hours,
        COUNT(*) AS total_resolved
      FROM \`work_orders\`
      WHERE organization_id = ?
        AND status = 'completed'
        AND completed_at IS NOT NULL
        AND created_at >= ? AND created_at <= ?
    `, [organizationId, dateFrom, dateTo]),
    db.queryReplica(`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        COUNT(*) AS count,
        ROUND(AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)), 2) AS avg_hours
      FROM \`work_orders\`
      WHERE organization_id = ?
        AND status = 'completed'
        AND completed_at IS NOT NULL
        AND created_at >= ? AND created_at <= ?
      GROUP BY month
      ORDER BY month ASC
    `, [organizationId, dateFrom, dateTo]),
  ]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    avg_mttr_hours: summaryRows[0].avg_mttr_hours,
    total_resolved: summaryRows[0].total_resolved,
    rows: monthRows,
  };
}

/**
 * Installation Completion — work orders by status grouped by month.
 */
async function installationCompletion(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m') AS month,
      COUNT(*) AS total,
      SUM(status = 'completed') AS completed,
      SUM(status IN ('pending', 'in_progress')) AS pending,
      SUM(status = 'cancelled') AS cancelled,
      ROUND(SUM(status = 'completed') / COUNT(*) * 100, 2) AS completion_rate
    FROM \`work_orders\`
    WHERE organization_id = ?
      AND created_at >= ? AND created_at <= ?
    GROUP BY month
    ORDER BY month ASC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

// =============================================================================
// §15.3 — Network Reports
// =============================================================================

/**
 * Congested Links — top 20 interfaces by average out-octets from snmp_metrics_1day.
 */
async function congestedLinks(organizationId, { days = 7, threshold_pct = 80 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      m.device_id,
      d.name AS device_name,
      m.interface_id,
      ROUND(AVG(m.avg_if_out_octets) * 8 / 1000000, 4) AS avg_out_mbps,
      ROUND(AVG(m.avg_if_in_octets) * 8 / 1000000, 4) AS avg_in_mbps
    FROM \`snmp_metrics_1day\` m
    JOIN \`devices\` d ON d.id = m.device_id
    WHERE d.organization_id = ?
      AND m.period_start >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY m.device_id, d.name, m.interface_id
    ORDER BY avg_out_mbps DESC
    LIMIT 20
  `, [organizationId, days]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    threshold_pct,
    rows,
  };
}

/**
 * SFP Lifespan — inventory with age in days for installed/removed/failed/retired SFPs.
 */
async function sfpLifespan(organizationId) {
  const [rows] = await db.queryReplica(`
    SELECT
      id,
      serial_number,
      vendor_name,
      part_number,
      lifecycle_status,
      installed_at,
      DATEDIFF(NOW(), installed_at) AS age_days
    FROM \`sfp_inventory\`
    WHERE organization_id = ?
      AND lifecycle_status IN ('installed', 'removed', 'failed', 'retired')
    ORDER BY age_days DESC
  `, [organizationId]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * Optical Degradation — ONU RX power averages and minimums grouped by device.
 */
async function opticalDegradation(organizationId, { days = 30 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      m.device_id,
      d.name AS device_name,
      ROUND(AVG(m.rx_power_dbm), 4) AS avg_rx_dbm,
      ROUND(MIN(m.rx_power_dbm), 4) AS min_rx_dbm,
      COUNT(*) AS sample_count
    FROM \`onu_optical_metrics\` m
    JOIN \`devices\` d ON d.id = m.device_id
    WHERE m.organization_id = ?
      AND m.polled_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY m.device_id, d.name
    ORDER BY avg_rx_dbm ASC
  `, [organizationId, days]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * Device Reboots — alert events with reboot metric grouped by device.
 */
async function deviceReboots(organizationId, { days = 30 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      ae.device_id,
      d.name AS device_name,
      COUNT(*) AS reboot_count
    FROM \`alert_events\` ae
    JOIN \`devices\` d ON d.id = ae.device_id
    WHERE ae.organization_id = ?
      AND ae.metric LIKE '%reboot%'
      AND ae.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY ae.device_id, d.name
    ORDER BY reboot_count DESC
  `, [organizationId, days]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * SNMP Poll Success — ratio of devices polled vs total devices in the org.
 */
async function snmpPollSuccess(organizationId, { days = 7 } = {}) {
  const [[deviceRows], [polledRows]] = await Promise.all([
    db.queryReplica(`
      SELECT COUNT(*) AS total_devices
      FROM \`devices\`
      WHERE organization_id = ? AND status != 'deleted'
    `, [organizationId]),
    db.queryReplica(`
      SELECT COUNT(DISTINCT m.device_id) AS polled_devices
      FROM \`snmp_metrics\` m
      JOIN \`devices\` d ON d.id = m.device_id
      WHERE d.organization_id = ?
        AND m.polled_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [organizationId, days]),
  ]);

  const totalDevices = deviceRows[0].total_devices;
  const polledDevices = polledRows[0].polled_devices;
  const successRatePct = totalDevices > 0
    ? parseFloat(((polledDevices / totalDevices) * 100).toFixed(2))
    : 0;

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    total_devices: totalDevices,
    polled_devices: polledDevices,
    success_rate_pct: successRatePct,
  };
}

/**
 * Alert Frequency — alert events grouped by date with resolution time.
 */
async function alertFrequency(organizationId, { days = 30 } = {}) {
  const [rows] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
      COUNT(*) AS alert_count,
      SUM(status = 'resolved') AS resolved_count,
      ROUND(
        AVG(CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) END),
        2
      ) AS avg_resolution_hours
    FROM \`alert_events\`
    WHERE organization_id = ? AND suppressed = 0
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
    ORDER BY date ASC
  `, [organizationId, days]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * Capacity Forecast — linear projection of subscribers and MRR for next N months.
 */
async function capacityForecast(organizationId, { months = 6 } = {}) {
  const [historical] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(period_date, '%Y-%m') AS month,
      total_clients_active AS subscribers,
      total_mrr AS mrr,
      currency
    FROM \`revenue_summary\`
    WHERE organization_id = ?
      AND period_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    ORDER BY period_date ASC
  `, [organizationId]);

  // Simple linear regression for subscribers and MRR
  const n = historical.length;
  const forecast = [];

  if (n >= 2) {
    const xs = historical.map((_, i) => i);
    const ysSub = historical.map(r => parseFloat(r.subscribers) || 0);
    const ysMrr = historical.map(r => parseFloat(r.mrr) || 0);

    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumXX = xs.reduce((s, x) => s + x * x, 0);
    const sumYSub = ysSub.reduce((s, y) => s + y, 0);
    const sumYMrr = ysMrr.reduce((s, y) => s + y, 0);
    const sumXYSub = xs.reduce((s, x, i) => s + x * ysSub[i], 0);
    const sumXYMrr = xs.reduce((s, x, i) => s + x * ysMrr[i], 0);

    const denom = n * sumXX - sumX * sumX;
    const mSub = denom !== 0 ? (n * sumXYSub - sumX * sumYSub) / denom : 0;
    const bSub = (sumYSub - mSub * sumX) / n;
    const mMrr = denom !== 0 ? (n * sumXYMrr - sumX * sumYMrr) / denom : 0;
    const bMrr = (sumYMrr - mMrr * sumX) / n;

    // Last historical date as base for projection
    const lastEntry = historical[n - 1];
    const [lastYear, lastMonthNum] = lastEntry.month.split('-').map(Number);

    for (let i = 1; i <= months; i++) {
      const projIdx = n - 1 + i;
      let yr = lastYear;
      let mo = lastMonthNum + i;
      while (mo > 12) {
        mo -= 12;
        yr += 1;
      }
      const monthLabel = `${yr}-${String(mo).padStart(2, '0')}`;
      forecast.push({
        month: monthLabel,
        projected_subscribers: Math.max(0, Math.round(mSub * projIdx + bSub)),
        projected_mrr: parseFloat(Math.max(0, mMrr * projIdx + bMrr).toFixed(2)),
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    historical,
    forecast,
  };
}

/**
 * PON Utilization — OLT port utilization by ONU count.
 */
async function ponUtilization(organizationId) {
  // Real columns are onu_count / max_onus (database/schema.sql) — the response
  // field names (current_onu_count / max_onu_count) are kept as-is via aliasing
  // since they are already part of this endpoint's response shape.
  const [rows] = await db.queryReplica(`
    SELECT
      id,
      port_name,
      olt_device_id,
      onu_count AS current_onu_count,
      max_onus AS max_onu_count,
      CASE
        WHEN max_onus > 0 THEN ROUND(onu_count / max_onus * 100, 2)
        ELSE 0
      END AS utilization_pct
    FROM \`olt_ports\`
    WHERE organization_id = ?
      AND port_type IN ('gpon', 'epon', 'xgspon')
    ORDER BY utilization_pct DESC
  `, [organizationId]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

// =============================================================================
// §15.4 — Compliance Reports
// =============================================================================

/**
 * Data Retention Compliance — count of records older than 7 years in key tables.
 */
async function dataRetentionCompliance(organizationId) {
  const tables = ['invoices', 'payments', 'clients', 'contracts'];
  const queries = tables.map(t =>
    db.queryReplica(`
      SELECT COUNT(*) AS old_record_count
      FROM \`${t}\`
      WHERE organization_id = ?
        AND created_at < DATE_SUB(NOW(), INTERVAL 7 YEAR)
    `, [organizationId]),
  );

  const results = await Promise.all(queries);
  const rows = tables.map((table_name, i) => ({
    table_name,
    old_record_count: results[i][0][0].old_record_count,
  }));

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    rows,
  };
}

/**
 * IP Assignment Log — IP assignment history with optional filters.
 */
async function ipAssignmentLog(organizationId, { from, to, ip_address } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const params = [organizationId, dateFrom, dateTo];
  let ipFilter = '';
  if (ip_address) {
    ipFilter = 'AND ia.ip_address = ?';
    params.push(ip_address);
  }

  const [rows] = await db.queryReplica(`
    SELECT
      ia.id,
      ia.ip_address,
      ia.type,
      c.name AS client_name,
      c.email AS client_email,
      ia.assigned_at,
      ia.expires_at,
      ia.status
    FROM \`ip_assignments\` ia
    LEFT JOIN \`clients\` c ON c.id = ia.client_id
    WHERE ia.organization_id = ?
      AND ia.assigned_at >= ? AND ia.assigned_at <= ?
      ${ipFilter}
    ORDER BY ia.assigned_at DESC
  `, params);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

/**
 * Subscriber Identity — clients with KYC-style data and contract counts.
 */
async function subscriberIdentity(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      c.id,
      c.name,
      c.email,
      c.status,
      COUNT(co.id) AS contract_count,
      c.created_at
    FROM \`clients\` c
    LEFT JOIN \`contracts\` co ON co.client_id = c.id AND co.organization_id = c.organization_id
    WHERE c.organization_id = ?
      AND c.created_at >= ? AND c.created_at <= ?
    GROUP BY c.id, c.name, c.email, c.status, c.created_at
    ORDER BY c.created_at DESC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

/**
 * Interception Readiness — check whether the org is set up for lawful intercept.
 */
async function interceptionReadiness(organizationId) {
  const [[nasRows], [activeContractRows], [ipRows]] = await Promise.all([
    db.queryReplica(`
      SELECT COUNT(*) AS cnt
      FROM \`devices\`
      WHERE organization_id = ? AND type = 'nas'
    `, [organizationId]),
    db.queryReplica(`
      SELECT COUNT(*) AS cnt
      FROM \`contracts\`
      WHERE organization_id = ? AND status = 'active'
    `, [organizationId]),
    db.queryReplica(`
      SELECT COUNT(*) AS cnt
      FROM \`ip_assignments\`
      WHERE organization_id = ? AND status = 'active'
    `, [organizationId]),
  ]);

  const hasNas = nasRows[0].cnt > 0;
  const activeContracts = activeContractRows[0].cnt;
  const ipAssignments = ipRows[0].cnt;
  // Considered ready if NAS exists, has active contracts, and has IP assignments
  const ready = hasNas && activeContracts > 0 && ipAssignments > 0;

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    has_nas: hasNas,
    has_radius_setup: hasNas, // Proxy: NAS presence implies RADIUS is configured
    active_contracts: activeContracts,
    ip_assignments: ipAssignments,
    ready,
  };
}

/**
 * Regulatory Export — clients with active contracts and IP assignments combined.
 */
async function regulatoryExport(organizationId, { from, to } = {}) {
  const dateFrom = from || defaultFrom();
  const dateTo = to || defaultTo();

  const [rows] = await db.queryReplica(`
    SELECT
      c.id AS client_id,
      c.name,
      c.email,
      ia.ip_address,
      co.id AS contract_id,
      p.name AS plan_name,
      ia.assigned_at
    FROM \`clients\` c
    JOIN \`contracts\` co ON co.client_id = c.id AND co.organization_id = c.organization_id
    JOIN \`ip_assignments\` ia ON ia.contract_id = co.id AND ia.organization_id = c.organization_id
    LEFT JOIN \`plans\` p ON p.id = co.plan_id
    WHERE c.organization_id = ?
      AND co.status = 'active'
      AND ia.status = 'active'
      AND ia.assigned_at >= ? AND ia.assigned_at <= ?
    ORDER BY c.name ASC
  `, [organizationId, dateFrom, dateTo]);

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    period: { from: dateFrom, to: dateTo },
    rows,
  };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // §14 — Original
  agingReport,
  financialSummary,
  technicianReport,
  subscriberGrowthReport,
  // §15.1 — Financial
  revenueByPeriod,
  revenueByPlan,
  revenueByRegion,
  revenueByAgent,
  cashFlowReport,
  paymentMethodBreakdown,
  churnRevenueImpact,
  agentCommissions,
  taxSummary,
  satExport,
  // §15.2 — Operational
  subscriberCounts,
  arpuReport,
  bandwidthUtilization,
  topConsumers,
  uptimeByArea,
  mttrReport,
  installationCompletion,
  // §15.3 — Network
  congestedLinks,
  sfpLifespan,
  opticalDegradation,
  deviceReboots,
  snmpPollSuccess,
  alertFrequency,
  capacityForecast,
  ponUtilization,
  // §15.4 — Compliance
  dataRetentionCompliance,
  ipAssignmentLog,
  subscriberIdentity,
  interceptionReadiness,
  regulatoryExport,
};
