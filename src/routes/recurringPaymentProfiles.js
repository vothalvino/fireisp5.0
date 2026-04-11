// =============================================================================
// FireISP 5.0 — Recurring Payment Profile Routes
// =============================================================================

const { Router } = require('express');
const RecurringPaymentProfile = require('../models/RecurringPaymentProfile');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRecurringPaymentProfile, updateRecurringPaymentProfile } = require('../middleware/schemas/recurringPaymentProfiles');

const router = Router();
const ctrl = crudController(RecurringPaymentProfile);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('recurring_payment_profiles.view'), ctrl.list);
router.get('/:id', requirePermission('recurring_payment_profiles.view'), ctrl.get);
router.post('/', requirePermission('recurring_payment_profiles.create'), validate(createRecurringPaymentProfile), ctrl.create);
router.put('/:id', requirePermission('recurring_payment_profiles.update'), validate(updateRecurringPaymentProfile), ctrl.update);
router.delete('/:id', requirePermission('recurring_payment_profiles.delete'), ctrl.destroy);

module.exports = router;
