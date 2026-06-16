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
const { createInvoice, updateInvoice, patchInvoice, addInvoiceItem } = require('../middleware/schemas/invoices');
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

// Generate invoice — supports two modes:
//   Legacy: { contract_id }  → billing-period invoice for a single contract
//   Flexible: { client_id, items: [{type, ...}] } → multi-item invoice
router.post('/generate', requirePermission('invoices.create'), async (req, res, next) => {
  try {
    const { contract_id, client_id, items } = req.body;

    // ----------------------------------------------------------------
    // LEGACY FORMAT: { contract_id }
    // ----------------------------------------------------------------
    if (contract_id && !client_id) {
      if (typeof contract_id !== 'number' || contract_id < 1) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_id must be a positive number' } });
      }
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
      const period = await billingService.generateBillingPeriod(contract);
      const invoice = await billingService.generateInvoice(period, contract, plans[0], req.orgId);
      return res.status(201).json({ data: invoice });
    }

    // ----------------------------------------------------------------
    // FLEXIBLE FORMAT: { client_id, items: [{type, ...}] }
    // ----------------------------------------------------------------
    if (!client_id || !Array.isArray(items) || items.length === 0) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Provide either contract_id (legacy) or client_id with a non-empty items array',
        },
      });
    }

    // Validate client belongs to org
    const [clientRows] = await db.query(
      'SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [client_id, req.orgId],
    );
    if (!clientRows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
    }

    // Pre-process items (billing-period lookups happen outside the tx)
    const lineItems = [];
    const billingPeriodUpdates = []; // { periodId }
    let currency = 'USD';
    let subtotal = 0;

    for (const item of items) {
      const type = item.type;

      if (type === 'contract') {
        if (!item.contract_id) {
          return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_id is required for contract-charge items' } });
        }
        const [contractRows] = await db.query(
          'SELECT * FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
          [item.contract_id, req.orgId],
        );
        if (!contractRows[0]) {
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Contract ${item.contract_id} not found` } });
        }
        const contract = contractRows[0];

        const [planRows] = await db.query('SELECT * FROM plans WHERE id = ? AND deleted_at IS NULL', [contract.plan_id]);
        if (!planRows[0]) {
          return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Plan not found for contract' } });
        }
        const plan = planRows[0];

        const period = await billingService.generateBillingPeriod(contract);
        const price = parseFloat(contract.price_override || plan.price);
        currency = plan.currency || 'USD';

        const periodStart = String(period.period_start).slice(0, 10);
        const periodEnd = String(period.period_end).slice(0, 10);
        lineItems.push({
          description: `${plan.name} — ${periodStart} to ${periodEnd}`,
          quantity: 1,
          unit_price: price,
          amount: price,
        });
        billingPeriodUpdates.push({ periodId: period.id });
        subtotal += price;
      } else if (type === 'product' || type === 'custom') {
        if (!item.description || String(item.description).trim() === '') {
          return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'description is required for product/custom items' } });
        }
        const qty = Math.max(parseFloat(item.quantity) || 1, 0.01);
        const up = Math.max(parseFloat(item.unit_price) || 0, 0);
        const amount = Math.round(qty * up * 100) / 100;
        lineItems.push({ description: String(item.description).trim(), quantity: qty, unit_price: up, amount });
        subtotal += amount;
      } else {
        return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: `Unknown item type: ${type}` } });
      }
    }

    // Get default tax rate
    const [taxRates] = await db.query(
      'SELECT * FROM tax_rates WHERE organization_id = ? AND is_default = TRUE LIMIT 1',
      [req.orgId],
    );
    const taxRate = taxRates[0];
    const taxPct = taxRate ? parseFloat(taxRate.rate) : 0;
    subtotal = Math.round(subtotal * 100) / 100;
    const taxAmount = Math.round(subtotal * taxPct) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    // Create invoice in a transaction
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [countResult] = await conn.execute(
        'SELECT COUNT(*) AS cnt FROM invoices WHERE organization_id = ?',
        [req.orgId],
      );
      const invoiceNumber = `INV-${String(countResult[0].cnt + 1).padStart(6, '0')}`;

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 15);

      const [invResult] = await conn.execute(
        `INSERT INTO invoices
           (organization_id, client_id, invoice_number, subtotal, tax_amount, total,
            currency, tax_rate, tax_rate_id, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
        [req.orgId, client_id, invoiceNumber, subtotal, taxAmount, total,
          currency, taxPct, taxRate?.id || null, dueDate],
      );
      const invoiceId = invResult.insertId;

      for (const li of lineItems) {
        await conn.execute(
          'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?)',
          [invoiceId, li.description, li.quantity, li.unit_price, li.amount],
        );
      }

      for (const bp of billingPeriodUpdates) {
        await conn.execute(
          "UPDATE billing_periods SET status = 'invoiced', invoice_id = ? WHERE id = ?",
          [invoiceId, bp.periodId],
        );
      }

      await conn.execute(
        `INSERT INTO client_balance_ledger
           (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
         VALUES (?, ?, 'debit', ?, ?, 'invoice', ?, ?)`,
        [client_id, req.orgId, total, currency, invoiceId, `Invoice ${invoiceNumber}`],
      );

      await conn.commit();
      const invoice = await Invoice.findById(invoiceId);
      return res.status(201).json({ data: invoice });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
       WHERE pa.invoice_id = ? AND pa.deleted_at IS NULL`,
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Thermal receipt — plain-text monospaced format for 58mm or 80mm printers
router.get('/:id/receipt', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const thermalReceiptService = require('../services/thermalReceiptService');
    const widthStr = req.query.width;
    const width = widthStr === '58' ? 32 : 48; // 58mm → 32 chars, 80mm → 48 chars (default)
    const text = await thermalReceiptService.generateInvoiceThermalReceipt(
      parseInt(req.params.id, 10),
      { width },
    );
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    next(err);
  }
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
