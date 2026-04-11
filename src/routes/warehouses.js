// =============================================================================
// FireISP 5.0 — Warehouse Routes
// =============================================================================

const { Router } = require('express');
const Warehouse = require('../models/Warehouse');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(Warehouse);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('inventory.view'), ctrl.list);
router.get('/:id', requirePermission('inventory.view'), ctrl.get);
router.post('/', requirePermission('inventory.create'), ctrl.create);
router.put('/:id', requirePermission('inventory.update'), ctrl.update);
router.delete('/:id', requirePermission('inventory.delete'), ctrl.destroy);

module.exports = router;
