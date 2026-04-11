// =============================================================================
// FireISP 5.0 — SLA Definition Routes
// =============================================================================

const { Router } = require('express');
const SlaDefinition = require('../models/SlaDefinition');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSlaDefinition, updateSlaDefinition } = require('../middleware/schemas/slaDefinitions');

const router = Router();
const ctrl = crudController(SlaDefinition);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('sla_definitions.view'), ctrl.list);
router.get('/:id', requirePermission('sla_definitions.view'), ctrl.get);
router.post('/', requirePermission('sla_definitions.create'), validate(createSlaDefinition), ctrl.create);
router.put('/:id', requirePermission('sla_definitions.update'), validate(updateSlaDefinition), ctrl.update);
router.delete('/:id', requirePermission('sla_definitions.delete'), ctrl.destroy);

module.exports = router;
