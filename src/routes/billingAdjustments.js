// =============================================================================
// FireISP 5.0 — Billing Adjustment Routes
// =============================================================================

const { Router } = require('express');
const BillingAdjustment = require('../models/BillingAdjustment');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createBillingAdjustmentSchema } = require('../middleware/schemas/billingAdjustments');
const billingAdjustmentService = require('../services/billingAdjustmentService');

const router = Router();
const ctrl = crudController(BillingAdjustment);

router.use(authenticate);
router.use(orgScope);

// List adjustments with filters
router.get('/', requirePermission('billing_adjustments.view'), ctrl.list);

// Get one adjustment
router.get('/:id', requirePermission('billing_adjustments.view'), ctrl.get);

// Manual create — delegates to service so audit log is always written
router.post('/', requirePermission('billing_adjustments.create'), validate(createBillingAdjustmentSchema), async (req, res, next) => {
  try {
    const adjustment = await billingAdjustmentService.record({
      organizationId: req.orgId,
      clientId: req.body.client_id,
      entityType: req.body.entity_type,
      entityId: req.body.entity_id,
      adjustmentType: req.body.adjustment_type,
      amountDelta: req.body.amount_delta,
      reason: req.body.reason,
      approvedBy: req.body.approved_by || null,
      createdBy: req.user.id,
    });
    res.status(201).json({ data: adjustment });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
