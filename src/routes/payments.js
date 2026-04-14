// =============================================================================
// FireISP 5.0 — Payment Routes
// =============================================================================

const { Router } = require('express');
const Payment = require('../models/Payment');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPayment, updatePayment, allocatePayment } = require('../middleware/schemas/payments');
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
router.post('/', requirePermission('payments.create'), validate(createPayment), async (req, res, next) => {
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

router.put('/:id', requirePermission('payments.update'), validate(updatePayment), ctrl.update);
router.delete('/:id', requirePermission('payments.delete'), ctrl.destroy);

// Allocate payment to invoice
router.post('/:id/allocate', requirePermission('payments.create'), validate(allocatePayment), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { invoice_id, amount } = req.body;
    const allocation = await Payment.allocate(req.params.id, invoice_id, amount);

    await conn.beginTransaction();

    // Check if invoice is now fully paid
    const [invoiceRows] = await conn.query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    const invoice = invoiceRows[0];
    if (invoice) {
      const [allocRows] = await conn.query(
        'SELECT SUM(amount) AS total_allocated FROM payment_allocations WHERE invoice_id = ?',
        [invoice_id],
      );
      const totalAllocated = parseFloat(allocRows[0].total_allocated || 0);
      if (totalAllocated >= parseFloat(invoice.total)) {
        await conn.query(
          'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
          ['paid', invoice_id],
        );

        // Check if contract was suspended → reconnect
        if (invoice.contract_id) {
          const [contractRows] = await conn.query(
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

    await conn.commit();
    res.status(201).json({ data: allocation });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
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
