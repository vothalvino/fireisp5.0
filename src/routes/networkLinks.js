// =============================================================================
// FireISP 5.0 — Network Link Routes
// =============================================================================

const { Router } = require('express');
const NetworkLink = require('../models/NetworkLink');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createNetworkLink, updateNetworkLink } = require('../middleware/schemas/networkLinks');

const router = Router();
const ctrl = crudController(NetworkLink);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('network_links.view'), ctrl.list);
router.get('/:id', requirePermission('network_links.view'), ctrl.get);
router.post('/', requirePermission('network_links.create'), validate(createNetworkLink), ctrl.create);
router.put('/:id', requirePermission('network_links.update'), validate(updateNetworkLink), ctrl.update);
router.delete('/:id', requirePermission('network_links.delete'), ctrl.destroy);

module.exports = router;
