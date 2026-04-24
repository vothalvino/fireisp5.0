// =============================================================================
// FireISP 5.0 — Scheduled Task Routes
// =============================================================================

const { Router } = require('express');
const ScheduledTask = require('../models/ScheduledTask');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createScheduledTask, updateScheduledTask } = require('../middleware/schemas/scheduledTasks');
const { quotaCheck } = require('../middleware/checkQuota');
const taskRunner = require('../services/taskRunner');

const router = Router();
const ctrl = crudController(ScheduledTask);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('scheduled_tasks.view'), ctrl.list);
router.get('/:id', requirePermission('scheduled_tasks.view'), ctrl.get);
router.post('/', requirePermission('scheduled_tasks.create'), quotaCheck('scheduled_tasks'), validate(createScheduledTask), ctrl.create);
router.put('/:id', requirePermission('scheduled_tasks.update'), validate(updateScheduledTask), ctrl.update);
router.delete('/:id', requirePermission('scheduled_tasks.delete'), ctrl.destroy);

// Manually trigger a task
router.post('/:id/run', requirePermission('scheduled_tasks.update'), async (req, res, next) => {
  try {
    const task = await ScheduledTask.findByIdOrFail(req.params.id);
    const result = await taskRunner.runTask(task.task_name, req.orgId);
    await taskRunner.markTaskRun(task.task_name);
    res.json({ data: { task_name: task.task_name, result } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
