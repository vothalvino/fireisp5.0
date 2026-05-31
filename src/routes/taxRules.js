// =============================================================================
// FireISP 5.0 — Tax Rule Routes
// =============================================================================

const { Router } = require('express');
const TaxRule = require('../models/TaxRule');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createTaxRule, updateTaxRule } = require('../middleware/schemas/taxRules');

const router = Router();
const ctrl = crudController(TaxRule);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tax_rules.view'), ctrl.list);
router.get('/:id', requirePermission('tax_rules.view'), ctrl.get);
router.post('/', requirePermission('tax_rules.create'), validate(createTaxRule), ctrl.create);
router.put('/:id', requirePermission('tax_rules.update'), validate(updateTaxRule), ctrl.update);
router.delete('/:id', requirePermission('tax_rules.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('tax_rules.update'), ctrl.restore);

module.exports = router;
