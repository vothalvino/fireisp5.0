// =============================================================================
// FireISP 5.0 — Site Routes
// =============================================================================

const { Router } = require('express');
const Site = require('../models/Site');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSite, updateSite } = require('../middleware/schemas/sites');

const router = Router();
const ctrl = crudController(Site);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('sites.view'), ctrl.list);
router.get('/:id', requirePermission('sites.view'), ctrl.get);
router.post('/', requirePermission('sites.create'), validate(createSite), ctrl.create);
router.put('/:id', requirePermission('sites.update'), validate(updateSite), ctrl.update);
router.delete('/:id', requirePermission('sites.delete'), ctrl.destroy);

module.exports = router;
