// =============================================================================
// FireISP 5.0 — Tax Rate Routes
// =============================================================================

const { Router } = require('express');
const TaxRate = require('../models/TaxRate');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createTaxRate, updateTaxRate } = require('../middleware/schemas/taxRates');

const router = Router();
const ctrl = crudController(TaxRate);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tax_rates.view'), ctrl.list);
router.get('/:id', requirePermission('tax_rates.view'), ctrl.get);
router.post('/', requirePermission('tax_rates.create'), validate(createTaxRate), ctrl.create);
router.put('/:id', requirePermission('tax_rates.update'), validate(updateTaxRate), ctrl.update);
router.delete('/:id', requirePermission('tax_rates.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('tax_rates.update'), ctrl.restore);

module.exports = router;
