// =============================================================================
// FireISP 5.0 — Scheduled Task Routes
// =============================================================================

const { Router } = require('express');
const ScheduledTask = require('../models/ScheduledTask');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(ScheduledTask);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('scheduled_tasks.view'), ctrl.list);
router.get('/:id', requirePermission('scheduled_tasks.view'), ctrl.get);
router.post('/', requirePermission('scheduled_tasks.create'), ctrl.create);
router.put('/:id', requirePermission('scheduled_tasks.update'), ctrl.update);
router.delete('/:id', requirePermission('scheduled_tasks.delete'), ctrl.destroy);

module.exports = router;
