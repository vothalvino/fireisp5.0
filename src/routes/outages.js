// =============================================================================
// FireISP 5.0 — Outage Routes
// =============================================================================

const { Router } = require('express');
const Outage = require('../models/Outage');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(Outage);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('outages.view'), ctrl.list);
router.get('/:id', requirePermission('outages.view'), ctrl.get);
router.post('/', requirePermission('outages.create'), ctrl.create);
router.put('/:id', requirePermission('outages.update'), ctrl.update);
router.delete('/:id', requirePermission('outages.delete'), ctrl.destroy);

module.exports = router;
