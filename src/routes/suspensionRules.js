// =============================================================================
// FireISP 5.0 — Suspension Rule Routes
// =============================================================================

const { Router } = require('express');
const SuspensionRule = require('../models/SuspensionRule');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSuspensionRule, updateSuspensionRule } = require('../middleware/schemas/suspensionRules');

const router = Router();
const ctrl = crudController(SuspensionRule);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('suspension_rules.view'), ctrl.list);
router.get('/:id', requirePermission('suspension_rules.view'), ctrl.get);
router.post('/', requirePermission('suspension_rules.create'), validate(createSuspensionRule), ctrl.create);
router.put('/:id', requirePermission('suspension_rules.update'), validate(updateSuspensionRule), ctrl.update);
router.delete('/:id', requirePermission('suspension_rules.delete'), ctrl.destroy);

module.exports = router;
