// =============================================================================
// FireISP 5.0 — Report Generation Service
// =============================================================================
// Generates business reports: aging (AR), financial summary, technician
// productivity, and subscriber growth. Returns structured data suitable
// for JSON API responses, CSV export, or PDF rendering.
// =============================================================================

const db = require('../config/database');

/**
 * Accounts Receivable Aging Report — groups unpaid invoices by age buckets.
 */
async function agingReport(organizationId, { currency } = {}) {
  let sql = `
    SELECT
      i.client_id,
      c.first_name, c.last_name, c.email,
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
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.organization_id = ? AND i.status = 'issued'
  `;
  const params = [organizationId];

  if (currency) {
    sql += ' AND i.currency = ?';
    params.push(currency);
  }

  sql += ' ORDER BY days_overdue DESC';
  const [rows] = await db.query(sql, params);

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
  const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const dateTo = to || new Date().toISOString().slice(0, 10);

  const currencyFilter = currency ? 'AND currency = ?' : '';
  const baseParams = currency ? [organizationId, dateFrom, dateTo, currency] : [organizationId, dateFrom, dateTo];

  const [[invoiceRows], [paymentRows], [expenseRows]] = await Promise.all([
    db.query(`
      SELECT
        COALESCE(SUM(total), 0) AS total_invoiced,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN status = 'issued' THEN total ELSE 0 END), 0) AS total_outstanding,
        COUNT(*) AS invoice_count
      FROM invoices
      WHERE organization_id = ? AND created_at >= ? AND created_at <= ? ${currencyFilter}
    `, baseParams),
    db.query(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_payments,
        COUNT(*) AS payment_count
      FROM payments
      WHERE organization_id = ? AND created_at >= ? AND created_at <= ? ${currencyFilter}
    `, baseParams),
    db.query(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_expenses,
        COUNT(*) AS expense_count
      FROM expenses
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
  const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const dateTo = to || new Date().toISOString().slice(0, 10);

  const [rows] = await db.query(`
    SELECT
      j.assigned_to AS user_id,
      u.first_name, u.last_name,
      COUNT(*) AS total_jobs,
      SUM(j.status = 'completed') AS completed,
      SUM(j.status = 'cancelled') AS cancelled,
      SUM(j.status IN ('pending', 'in_progress')) AS in_progress,
      ROUND(AVG(CASE WHEN j.status = 'completed' THEN TIMESTAMPDIFF(HOUR, j.created_at, j.updated_at) END), 1) AS avg_completion_hours
    FROM jobs j
    LEFT JOIN users u ON u.id = j.assigned_to
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
  const [rows] = await db.query(`
    SELECT
      DATE_FORMAT(c.created_at, '%Y-%m') AS month,
      SUM(c.status IN ('active', 'suspended')) AS new_contracts,
      SUM(c.status = 'cancelled') AS churned
    FROM contracts c
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

module.exports = { agingReport, financialSummary, technicianReport, subscriberGrowthReport };
