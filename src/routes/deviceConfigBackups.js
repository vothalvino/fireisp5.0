// =============================================================================
// FireISP 5.0 — Device Config Backup Routes
// =============================================================================

const { Router } = require('express');
const DeviceConfigBackup = require('../models/DeviceConfigBackup');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(DeviceConfigBackup);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('device_config_backups.view'), ctrl.list);
router.get('/:id', requirePermission('device_config_backups.view'), ctrl.get);
router.post('/', requirePermission('device_config_backups.create'), ctrl.create);
router.put('/:id', requirePermission('device_config_backups.update'), ctrl.update);
router.delete('/:id', requirePermission('device_config_backups.delete'), ctrl.destroy);

module.exports = router;
