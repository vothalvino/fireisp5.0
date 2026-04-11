// =============================================================================
// FireISP 5.0 — Device Routes
// =============================================================================

const { Router } = require('express');
const Device = require('../models/Device');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createDevice, updateDevice } = require('../middleware/schemas/devices');

const router = Router();
const ctrl = crudController(Device);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createDevice), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateDevice), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);

module.exports = router;
