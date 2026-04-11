// =============================================================================
// FireISP 5.0 — Speed Test Routes
// =============================================================================

const { Router } = require('express');
const SpeedTest = require('../models/SpeedTest');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSpeedTest, updateSpeedTest } = require('../middleware/schemas/speedTests');

const router = Router();
const ctrl = crudController(SpeedTest);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('speed_tests.view'), ctrl.list);
router.get('/:id', requirePermission('speed_tests.view'), ctrl.get);
router.post('/', requirePermission('speed_tests.create'), validate(createSpeedTest), ctrl.create);
router.put('/:id', requirePermission('speed_tests.update'), validate(updateSpeedTest), ctrl.update);
router.delete('/:id', requirePermission('speed_tests.delete'), ctrl.destroy);

module.exports = router;
