// =============================================================================
// FireISP 5.0 — Export Controller
// =============================================================================
// CSV export endpoints for invoices, clients, contracts, and payments.
// =============================================================================

const db = require('../config/database');

/**
 * Converts an array of objects to a CSV string.
 */
function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape commas, quotes, newlines
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * GET /api/export/invoices
 */
async function exportInvoices(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT i.id, i.invoice_number, i.client_id, cl.name, cl.email,
              i.subtotal, i.tax_amount, i.total, i.currency, i.status, i.due_date, i.created_at
       FROM invoices i
       LEFT JOIN clients cl ON cl.id = i.client_id
       WHERE i.organization_id = ?
       ORDER BY i.created_at DESC`,
      [req.orgId],
    );

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send(toCsv(rows));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/export/clients
 */
async function exportClients(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, phone, status, locale, country, city, state, created_at
       FROM clients
       WHERE organization_id = ?
       ORDER BY name`,
      [req.orgId],
    );

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="clients.csv"');
    res.send(toCsv(rows));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/export/contracts
 */
async function exportContracts(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT c.id, c.client_id, cl.name, p.name AS plan_name,
              c.status, c.connection_type, c.start_date, c.end_date, c.price_override, p.price AS plan_price, p.currency
       FROM contracts c
       JOIN clients cl ON cl.id = c.client_id
       JOIN plans p ON p.id = c.plan_id
       WHERE c.organization_id = ?
       ORDER BY c.created_at DESC`,
      [req.orgId],
    );

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="contracts.csv"');
    res.send(toCsv(rows));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/export/payments
 */
async function exportPayments(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.client_id, cl.name,
              p.amount, p.currency, p.payment_method, p.payment_date, p.reference_number, p.status, p.created_at
       FROM payments p
       LEFT JOIN clients cl ON cl.id = p.client_id
       WHERE p.organization_id = ?
       ORDER BY p.created_at DESC`,
      [req.orgId],
    );

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send(toCsv(rows));
  } catch (err) {
    next(err);
  }
}

module.exports = { exportInvoices, exportClients, exportContracts, exportPayments, toCsv };
