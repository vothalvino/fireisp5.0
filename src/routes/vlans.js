// =============================================================================
// FireISP 5.0 — VLAN Routes
// =============================================================================

const { Router } = require('express');
const Vlan = require('../models/Vlan');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(Vlan);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('vlans.view'), ctrl.list);
router.get('/:id', requirePermission('vlans.view'), ctrl.get);
router.post('/', requirePermission('vlans.create'), ctrl.create);
router.put('/:id', requirePermission('vlans.update'), ctrl.update);
router.delete('/:id', requirePermission('vlans.delete'), ctrl.destroy);

module.exports = router;
