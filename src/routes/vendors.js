// =============================================================================
// FireISP 5.0 — Vendor Routes — §14.2
// =============================================================================

const { Router } = require('express');
const Vendor = require('../models/Vendor');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createVendor, updateVendor } = require('../middleware/schemas/vendors');

const router = Router();
const ctrl = crudController(Vendor);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('vendors.view'), ctrl.list);
router.get('/:id', requirePermission('vendors.view'), ctrl.get);
router.post('/', requirePermission('vendors.create'), validate(createVendor), ctrl.create);
router.put('/:id', requirePermission('vendors.update'), validate(updateVendor), ctrl.update);
router.delete('/:id', requirePermission('vendors.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('vendors.update'), ctrl.restore);

module.exports = router;
