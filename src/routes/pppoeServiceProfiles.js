// =============================================================================
// FireISP 5.0 — PPPoE Service Profile Routes
// =============================================================================

const { Router } = require('express');
const PppoeServiceProfile = require('../models/PppoeServiceProfile');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPppoeServiceProfile, updatePppoeServiceProfile } = require('../middleware/schemas/pppoeServiceProfiles');

const router = Router();
const ctrl = crudController(PppoeServiceProfile);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('pppoe_service_profiles.view'), ctrl.list);
router.get('/:id', requirePermission('pppoe_service_profiles.view'), ctrl.get);
router.post('/', requirePermission('pppoe_service_profiles.create'), validate(createPppoeServiceProfile), ctrl.create);
router.put('/:id', requirePermission('pppoe_service_profiles.update'), validate(updatePppoeServiceProfile), ctrl.update);
router.delete('/:id', requirePermission('pppoe_service_profiles.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('pppoe_service_profiles.update'), ctrl.restore);

module.exports = router;
