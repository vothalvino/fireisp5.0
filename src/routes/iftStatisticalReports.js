// =============================================================================
// FireISP 5.0 — IFT Statistical Report Routes
// =============================================================================

const { Router } = require('express');
const IftStatisticalReport = require('../models/IftStatisticalReport');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(IftStatisticalReport);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('ift_statistical_reports.view'), ctrl.list);
router.get('/:id', requirePermission('ift_statistical_reports.view'), ctrl.get);
router.post('/', requirePermission('ift_statistical_reports.create'), ctrl.create);
router.put('/:id', requirePermission('ift_statistical_reports.update'), ctrl.update);
router.delete('/:id', requirePermission('ift_statistical_reports.delete'), ctrl.destroy);

module.exports = router;
