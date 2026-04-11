// =============================================================================
// FireISP 5.0 — Regulatory Filing Routes
// =============================================================================

const { Router } = require('express');
const RegulatoryFiling = require('../models/RegulatoryFiling');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRegulatoryFiling, updateRegulatoryFiling } = require('../middleware/schemas/regulatoryFilings');

const router = Router();
const ctrl = crudController(RegulatoryFiling);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('regulatory_filings.view'), ctrl.list);
router.get('/:id', requirePermission('regulatory_filings.view'), ctrl.get);
router.post('/', requirePermission('regulatory_filings.create'), validate(createRegulatoryFiling), ctrl.create);
router.put('/:id', requirePermission('regulatory_filings.update'), validate(updateRegulatoryFiling), ctrl.update);
router.delete('/:id', requirePermission('regulatory_filings.delete'), ctrl.destroy);

module.exports = router;
