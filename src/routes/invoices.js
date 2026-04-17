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

// Invoice line items
router.get('/:id/items', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
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
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ?',
      [contract_id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    const contract = contracts[0];

    const [plans] = await db.query('SELECT * FROM plans WHERE id = ?', [contract.plan_id]);
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

module.exports = router;
