// =============================================================================
// FireISP 5.0 — Outage Routes
// =============================================================================

const { Router } = require('express');
const Outage = require('../models/Outage');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createOutage, updateOutage } = require('../middleware/schemas/outages');

const router = Router();
const ctrl = crudController(Outage);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('outages.view'), ctrl.list);
router.get('/:id', requirePermission('outages.view'), ctrl.get);
router.post('/', requirePermission('outages.create'), validate(createOutage), ctrl.create);
router.put('/:id', requirePermission('outages.update'), validate(updateOutage), ctrl.update);
router.delete('/:id', requirePermission('outages.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('outages.update'), ctrl.restore);

module.exports = router;
