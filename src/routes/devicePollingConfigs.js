// =============================================================================
// FireISP 5.0 — Device Polling Config Routes (§6.4)
// =============================================================================
//
// GET    /device-polling-configs              — list (polling_configs.view)
// POST   /device-polling-configs              — create (polling_configs.create)
// GET    /device-polling-configs/:id          — get by id (polling_configs.view)
// PUT    /device-polling-configs/:id          — update (polling_configs.update)
// DELETE /device-polling-configs/:id          — delete (polling_configs.delete)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { crudController } = require('../controllers/crudController');
const DevicePollingConfig = require('../models/DevicePollingConfig');
const { createDevicePollingConfig, updateDevicePollingConfig } = require('../middleware/schemas/devicePollingConfigs');

const router = Router();
router.use(authenticate);
router.use(orgScope);

const ctrl = crudController(DevicePollingConfig);

router.get('/',     requirePermission('polling_configs.view'),   ctrl.list);
router.get('/:id',  requirePermission('polling_configs.view'),   ctrl.get);
router.post('/',    requirePermission('polling_configs.create'),  validate(createDevicePollingConfig), ctrl.create);
router.put('/:id',  requirePermission('polling_configs.update'),  validate(updateDevicePollingConfig), ctrl.update);
router.delete('/:id', requirePermission('polling_configs.delete'), ctrl.destroy);

module.exports = router;
