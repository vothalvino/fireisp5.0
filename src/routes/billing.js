// =============================================================================
// FireISP 5.0 — Billing Workflow Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const billingSchemas = require('../middleware/schemas/billing');
const billingController = require('../controllers/billingController');
const db = require('../config/database');
const auditLog = require('../services/auditLog');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.post('/generate-period',
  requirePermission('invoices.create'),
  validate(billingSchemas.generatePeriod),
  billingController.generatePeriod,
);

router.post('/generate-invoice',
  requirePermission('invoices.create'),
  validate(billingSchemas.generateInvoice),
  billingController.generateInvoice,
);

router.post('/allocate-payment',
  requirePermission('payments.create'),
  validate(billingSchemas.allocatePayment),
  billingController.allocatePayment,
);

router.post('/bulk-generate',
  requirePermission('invoices.create'),
  billingController.bulkGenerate,
);

// ---------------------------------------------------------------------------
// Tax Report Export — GET /billing/tax-reports
// Query params:
//   from    (YYYY-MM-DD)  — start date (inclusive)
//   to      (YYYY-MM-DD)  — end date (inclusive)
//   type    invoices|payments|credit_notes  (default: invoices)
//   format  csv|json      (default: json)
// ---------------------------------------------------------------------------
router.get('/tax-reports',
  requirePermission('billing.tax_reports'),
  async (req, res, next) => {
    try {
      const { from, to, type = 'invoices', format = 'json' } = req.query;
      const orgId = req.organizationId;

      let rows;

      if (type === 'payments') {
        const [results] = await db.query(
          `SELECT p.id, p.amount, p.currency, p.payment_method,
                  p.payment_date, p.reference_number,
                  CONCAT(cl.first_name, ' ', cl.last_name) AS client_name,
                  cl.tax_id AS client_tax_id
           FROM payments p
           LEFT JOIN clients cl ON cl.id = p.client_id
           WHERE p.organization_id = ?
             AND p.deleted_at IS NULL
             ${from ? 'AND DATE(p.payment_date) >= ?' : ''}
             ${to   ? 'AND DATE(p.payment_date) <= ?' : ''}
           ORDER BY p.payment_date`,
          [orgId, ...(from ? [from] : []), ...(to ? [to] : [])],
        );
        rows = results;
      } else if (type === 'credit_notes') {
        const [results] = await db.query(
          `SELECT cn.id, cn.credit_note_number, cn.total, cn.tax_amount,
                  cn.currency, cn.status, cn.created_at, cn.reason,
                  CONCAT(cl.first_name, ' ', cl.last_name) AS client_name,
                  cl.tax_id AS client_tax_id,
                  cd.uuid AS cfdi_uuid
           FROM credit_notes cn
           LEFT JOIN clients cl ON cl.id = cn.client_id
           LEFT JOIN cfdi_documents cd ON cd.credit_note_id = cn.id AND cd.deleted_at IS NULL
           WHERE cn.organization_id = ?
             AND cn.deleted_at IS NULL
             ${from ? 'AND DATE(cn.created_at) >= ?' : ''}
             ${to   ? 'AND DATE(cn.created_at) <= ?' : ''}
           ORDER BY cn.created_at`,
          [orgId, ...(from ? [from] : []), ...(to ? [to] : [])],
        );
        rows = results;
      } else {
        // Default: invoices
        const [results] = await db.query(
          `SELECT i.id, i.invoice_number, i.subtotal, i.tax_amount, i.total,
                  i.currency, i.status, i.created_at, i.due_date, i.paid_at,
                  CONCAT(cl.first_name, ' ', cl.last_name) AS client_name,
                  cl.tax_id AS client_tax_id,
                  cd.uuid AS cfdi_uuid
           FROM invoices i
           LEFT JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN cfdi_documents cd ON cd.invoice_id = i.id AND cd.deleted_at IS NULL
           WHERE i.organization_id = ?
             AND i.deleted_at IS NULL
             ${from ? 'AND DATE(i.created_at) >= ?' : ''}
             ${to   ? 'AND DATE(i.created_at) <= ?' : ''}
           ORDER BY i.created_at`,
          [orgId, ...(from ? [from] : []), ...(to ? [to] : [])],
        );
        rows = results;
      }

      // Audit log
      await auditLog.log({
        userId: req.user?.id || null,
        organizationId: orgId,
        action: 'tax_report_export',
        tableName: type,
        recordId: null,
        newValues: { from, to, type, format, row_count: rows.length },
      });

      if (format === 'csv') {
        if (rows.length === 0) {
          res.set('Content-Type', 'text/csv');
          return res.send('');
        }
        const headers = Object.keys(rows[0]).join(',');
        const csvRows = rows.map(row =>
          Object.values(row).map(v => {
            if (v === null || v === undefined) return '';
            const s = String(v).replace(/"/g, '""');
            return /[,"\n\r]/.test(s) ? `"${s}"` : s;
          }).join(','),
        );
        const csv = [headers, ...csvRows].join('\n');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="tax-report-${type}-${new Date().toISOString().slice(0,10)}.csv"`);
        return res.send(csv);
      }

      res.json({ data: rows, meta: { type, from: from || null, to: to || null, count: rows.length } });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
