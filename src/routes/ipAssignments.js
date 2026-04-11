// =============================================================================
// FireISP 5.0 — IP Assignment Routes
// =============================================================================

const { Router } = require('express');
const IpAssignment = require('../models/IpAssignment');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(IpAssignment);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('ip_assignments.view'), ctrl.list);
router.get('/:id', requirePermission('ip_assignments.view'), ctrl.get);
router.post('/', requirePermission('ip_assignments.create'), ctrl.create);
router.put('/:id', requirePermission('ip_assignments.update'), ctrl.update);
router.delete('/:id', requirePermission('ip_assignments.delete'), ctrl.destroy);

module.exports = router;
