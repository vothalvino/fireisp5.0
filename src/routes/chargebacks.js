// =============================================================================
// FireISP 5.0 — Chargeback Routes
// =============================================================================

const { Router } = require('express');
const Chargeback = require('../models/Chargeback');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createChargebackSchema, updateChargebackSchema } = require('../middleware/schemas/chargebacks');

const router = Router();
const ctrl = crudController(Chargeback);

router.use(authenticate);
router.use(orgScope);

// List chargebacks
router.get('/', requirePermission('chargebacks.view'), ctrl.list);

// Get one chargeback
router.get('/:id', requirePermission('chargebacks.view'), ctrl.get);

// Manual create
router.post('/', requirePermission('chargebacks.create'), validate(createChargebackSchema), async (req, res, next) => {
  try {
    const chargeback = await Chargeback.create({
      organization_id: req.orgId || null,
      payment_id: req.body.payment_id || null,
      gateway: req.body.gateway || null,
      gateway_dispute_id: req.body.gateway_dispute_id || null,
      amount: req.body.amount,
      currency: req.body.currency || 'USD',
      reason_code: req.body.reason_code || null,
      status: req.body.status || 'received',
      due_by: req.body.due_by || null,
    });
    res.status(201).json({ data: chargeback });
  } catch (err) {
    next(err);
  }
});

// Update status/outcome
router.put('/:id', requirePermission('chargebacks.update'), validate(updateChargebackSchema), async (req, res, next) => {
  try {
    const updated = await Chargeback.update(req.params.id, req.body, req.orgId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Soft delete
router.delete('/:id', requirePermission('chargebacks.update'), ctrl.destroy);

module.exports = router;
