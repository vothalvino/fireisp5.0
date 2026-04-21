// =============================================================================
// FireISP 5.0 — Invoice Routes
// =============================================================================

const { Router } = require('express');
const Invoice = require('../models/Invoice');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createInvoice, updateInvoice, patchInvoice, addInvoiceItem, generateInvoice } = require('../middleware/schemas/invoices');
const billingService = require('../services/billingService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Invoice);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('invoices.view'), ctrl.list);
router.get('/:id', requirePermission('invoices.view'), ctrl.get);
router.post('/', requirePermission('invoices.create'), validate(createInvoice), ctrl.create);
router.put('/:id', requirePermission('invoices.update'), validate(updateInvoice), ctrl.update);
router.patch('/:id', requirePermission('invoices.update'), validate(patchInvoice), ctrl.partialUpdate);
router.delete('/:id', requirePermission('invoices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('invoices.update'), ctrl.restore);

// Invoice line items
router.get('/:id/items', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL', [req.params.id]);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Add invoice line item
router.post('/:id/items', requirePermission('invoices.update'), validate(addInvoiceItem), async (req, res, next) => {
  try {
    const item = await Invoice.addItem({ invoice_id: req.params.id, ...req.body });
    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

// Generate invoice for a contract billing period
router.post('/generate', requirePermission('invoices.create'), validate(generateInvoice), async (req, res, next) => {
  try {
    const { contract_id } = req.body;

    // Fetch contract and plan
    const [contracts] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [contract_id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    const contract = contracts[0];

    const [plans] = await db.query('SELECT * FROM plans WHERE id = ? AND deleted_at IS NULL', [contract.plan_id]);
    if (!plans[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
    }

    // Generate billing period then invoice
    const period = await billingService.generateBillingPeriod(contract);
    const invoice = await billingService.generateInvoice(period, contract, plans[0], req.orgId);
    res.status(201).json({ data: invoice });
  } catch (err) {
    next(err);
  }
});

// Invoice payments
router.get('/:id/payments', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT pa.*, p.amount AS payment_amount, p.payment_method, p.payment_date
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.invoice_id = ?`,
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Send invoice email with PDF attachment to the client
router.post('/:id/send-email', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    const pdfService = require('../services/pdfService');
    const emailTransport = require('../services/emailTransport');
    const templates = require('../views/emailTemplates');

    const [rows] = await db.query(
      `SELECT i.*,
              cl.name AS client_name, cl.email AS client_email,
              o.name AS org_name
       FROM invoices i
       LEFT JOIN clients cl ON cl.id = i.client_id
       LEFT JOIN organizations o ON o.id = i.organization_id
       WHERE i.id = ? AND i.deleted_at IS NULL`,
      [invoiceId],
    );
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
    if (!invoice.client_email) return res.status(422).json({ error: { code: 'NO_EMAIL', message: 'Client has no email address' } });

    const locale = req.query.locale || 'en';
    const buffer = await pdfService.generateInvoicePdf(invoiceId, { locale });

    const [itemRows] = await db.query(
      'SELECT description, amount FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL',
      [invoiceId],
    );

    const template = templates.invoiceEmail({
      clientName: invoice.client_name,
      orgName: invoice.org_name,
      invoiceNumber: invoice.invoice_number,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: invoice.due_date ? String(invoice.due_date).slice(0, 10) : '',
      items: itemRows,
    });

    await emailTransport.sendEmail({
      organizationId: invoice.organization_id,
      to: invoice.client_email,
      subject: template.subject,
      html: template.html,
      attachments: [{ filename: `invoice-${invoice.invoice_number || invoiceId}.pdf`, content: buffer }],
    });

    res.json({ message: 'Invoice sent', to: invoice.client_email });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
