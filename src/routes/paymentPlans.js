// =============================================================================
// FireISP 5.0 — Payment Plans Routes
// =============================================================================

const { Router } = require('express');
const PaymentPlan = require('../models/PaymentPlan');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createPaymentPlan,
  updatePaymentPlan,
  payInstallmentSchema,
} = require('../middleware/schemas/paymentPlans');
const paymentPlanService = require('../services/paymentPlanService');

const router = Router();
const ctrl = crudController(PaymentPlan);

router.use(authenticate);
router.use(orgScope);

// List plans
router.get('/', requirePermission('payment_plans.view'), ctrl.list);

// Get plan with installments
router.get('/:id', requirePermission('payment_plans.view'), async (req, res, next) => {
  try {
    const result = await paymentPlanService.getPlanWithInstallments(
      parseInt(req.params.id, 10),
      req.orgId,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Create plan
router.post('/', requirePermission('payment_plans.create'), validate(createPaymentPlan), async (req, res, next) => {
  try {
    const {
      client_id,
      invoice_id,
      total_amount,
      installment_count,
      frequency,
      notes,
    } = req.body;

    const result = await paymentPlanService.createPlan({
      organizationId: req.orgId,
      clientId: client_id,
      invoiceId: invoice_id,
      totalAmount: total_amount,
      installmentCount: installment_count,
      frequency,
      notes,
      createdBy: req.user.id,
    });

    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Update notes/status only
router.put('/:id', requirePermission('payment_plans.update'), validate(updatePaymentPlan), async (req, res, next) => {
  try {
    const updated = await PaymentPlan.update(
      parseInt(req.params.id, 10),
      req.body,
      req.orgId,
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Soft delete
router.delete('/:id', requirePermission('payment_plans.delete'), ctrl.destroy);

// Pay an installment
router.post(
  '/:id/installments/:seq/pay',
  requirePermission('payment_plans.update'),
  validate(payInstallmentSchema),
  async (req, res, next) => {
    try {
      const planId = parseInt(req.params.id, 10);
      const sequence = parseInt(req.params.seq, 10);
      const { payment_id } = req.body;

      const installment = await paymentPlanService.payInstallment(
        planId,
        sequence,
        payment_id,
        req.orgId,
      );

      res.json({ data: installment });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
