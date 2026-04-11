// =============================================================================
// FireISP 5.0 — Coverage Zone Routes
// =============================================================================

const { Router } = require('express');
const CoverageZone = require('../models/CoverageZone');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(CoverageZone);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('coverage_zones.view'), ctrl.list);
router.get('/:id', requirePermission('coverage_zones.view'), ctrl.get);
router.post('/', requirePermission('coverage_zones.create'), ctrl.create);
router.put('/:id', requirePermission('coverage_zones.update'), ctrl.update);
router.delete('/:id', requirePermission('coverage_zones.delete'), ctrl.destroy);

module.exports = router;
