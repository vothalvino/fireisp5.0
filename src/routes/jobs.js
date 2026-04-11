// =============================================================================
// FireISP 5.0 — Job Routes
// =============================================================================

const { Router } = require('express');
const Job = require('../models/Job');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createJob, updateJob } = require('../middleware/schemas/jobs');

const router = Router();
const ctrl = crudController(Job);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('jobs.view'), ctrl.list);
router.get('/:id', requirePermission('jobs.view'), ctrl.get);
router.post('/', requirePermission('jobs.create'), validate(createJob), ctrl.create);
router.put('/:id', requirePermission('jobs.update'), validate(updateJob), ctrl.update);
router.delete('/:id', requirePermission('jobs.delete'), ctrl.destroy);

module.exports = router;
