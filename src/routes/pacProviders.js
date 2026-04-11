// =============================================================================
// FireISP 5.0 — PAC Provider Routes
// =============================================================================

const { Router } = require('express');
const PacProvider = require('../models/PacProvider');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPacProvider, updatePacProvider } = require('../middleware/schemas/pacProviders');

const router = Router();
const ctrl = crudController(PacProvider);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('pac_providers.view'), ctrl.list);
router.get('/:id', requirePermission('pac_providers.view'), ctrl.get);
router.post('/', requirePermission('pac_providers.create'), validate(createPacProvider), ctrl.create);
router.put('/:id', requirePermission('pac_providers.update'), validate(updatePacProvider), ctrl.update);
router.delete('/:id', requirePermission('pac_providers.delete'), ctrl.destroy);

module.exports = router;
