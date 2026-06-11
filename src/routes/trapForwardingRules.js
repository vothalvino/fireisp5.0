// =============================================================================
// FireISP 5.0 — SNMP Trap Forwarding Rule Routes  §6.1
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { crudController } = require('../controllers/crudController');
const TrapForwardingRule = require('../models/TrapForwardingRule');
const { createTrapForwardingRule, updateTrapForwardingRule } = require('../middleware/schemas/trapForwardingRules');

const router = Router();
router.use(authenticate);
router.use(orgScope);

const ctrl = crudController(TrapForwardingRule);

router.get('/',     requirePermission('trap_forwarding.view'),   ctrl.list);
router.get('/:id',  requirePermission('trap_forwarding.view'),   ctrl.get);
router.post('/',    requirePermission('trap_forwarding.create'),  validate(createTrapForwardingRule), ctrl.create);
router.put('/:id',  requirePermission('trap_forwarding.update'),  validate(updateTrapForwardingRule), ctrl.update);
router.delete('/:id', requirePermission('trap_forwarding.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('trap_forwarding.update'), ctrl.restore);

module.exports = router;
