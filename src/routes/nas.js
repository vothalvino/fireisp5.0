// =============================================================================
// FireISP 5.0 — NAS Routes
// =============================================================================

const { Router } = require('express');
const Nas = require('../models/Nas');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(Nas);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), ctrl.create);
router.put('/:id', requirePermission('devices.update'), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);

module.exports = router;
