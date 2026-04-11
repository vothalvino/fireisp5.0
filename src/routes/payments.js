// =============================================================================
// FireISP 5.0 — Payment Routes
// =============================================================================

const { Router } = require('express');
const Payment = require('../models/Payment');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const billingService = require('../services/billingService');
const suspensionService = require('../services/suspensionService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Payment);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('payments.view'), ctrl.list);
router.get('/:id', requirePermission('payments.view'), ctrl.get);

// Create a payment and optionally allocate + reconnect
router.post('/', requirePermission('payments.create'), async (req, res, next) => {
  try {
    req.body.organization_id = req.orgId;
    const payment = await Payment.create(req.body);

    // Update client balance ledger
    await billingService.recordPaymentCredit(payment, req.orgId);

    res.status(201).json({ data: payment });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('payments.update'), ctrl.update);
router.delete('/:id', requirePermission('payments.delete'), ctrl.destroy);

// Allocate payment to invoice
router.post('/:id/allocate', requirePermission('payments.create'), async (req, res, next) => {
  try {
    const { invoice_id, amount } = req.body;
    const allocation = await Payment.allocate(req.params.id, invoice_id, amount);

    // Check if invoice is now fully paid
    const [invoiceRows] = await db.query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    const invoice = invoiceRows[0];
    if (invoice) {
      const [allocRows] = await db.query(
        'SELECT SUM(amount) AS total_allocated FROM payment_allocations WHERE invoice_id = ?',
        [invoice_id],
      );
      const totalAllocated = parseFloat(allocRows[0].total_allocated || 0);
      if (totalAllocated >= parseFloat(invoice.total)) {
        await db.query(
          'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
          ['paid', invoice_id],
        );

        // Check if contract was suspended → reconnect
        if (invoice.contract_id) {
          const [contractRows] = await db.query(
            'SELECT * FROM contracts WHERE id = ? AND status = ?',
            [invoice.contract_id, 'suspended'],
          );
          if (contractRows[0]) {
            await suspensionService.reconnectContract(
              invoice.contract_id, req.user.id, invoice_id,
            );
          }
        }
      }
    }

    res.status(201).json({ data: allocation });
  } catch (err) {
    next(err);
  }
});

// Get payment allocations
router.get('/:id/allocations', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const allocations = await Payment.getAllocations(req.params.id);
    res.json({ data: allocations });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
