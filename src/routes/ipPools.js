// =============================================================================
// FireISP 5.0 — IP Pool Routes
// =============================================================================

const { Router } = require('express');
const IpPool = require('../models/IpPool');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(IpPool);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('ip_pools.view'), ctrl.list);
router.get('/:id', requirePermission('ip_pools.view'), ctrl.get);
router.post('/', requirePermission('ip_pools.create'), ctrl.create);
router.put('/:id', requirePermission('ip_pools.update'), ctrl.update);
router.delete('/:id', requirePermission('ip_pools.delete'), ctrl.destroy);

module.exports = router;
