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
const { createSite, updateSite, patchSite } = require('../middleware/schemas/sites');
const { httpCache } = require('../middleware/httpCache');

const router = Router();
const ctrl = crudController(Site, { cacheResource: 'sites' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('sites.view'), httpCache('sites', 300), ctrl.list);
router.get('/:id', requirePermission('sites.view'), ctrl.get);
router.post('/', requirePermission('sites.create'), validate(createSite), ctrl.create);
router.put('/:id', requirePermission('sites.update'), validate(updateSite), ctrl.update);
router.patch('/:id', requirePermission('sites.update'), validate(patchSite), ctrl.partialUpdate);
router.delete('/:id', requirePermission('sites.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('sites.update'), ctrl.restore);

module.exports = router;
