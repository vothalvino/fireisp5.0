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
const db = require('../config/database');
const { isInstallOperator, OPERATOR_ONLY_MESSAGE } = require('../services/installOperator');

const router = Router();
const ctrl = crudController(ScheduledTask);

async function requireInstallOperator(req, res, next) {
  try {
    if (await isInstallOperator(req)) return next();
    return res.status(403).json({
      error: { code: 'INSTALL_OPERATOR_ONLY', message: OPERATOR_ONLY_MESSAGE },
    });
  } catch (err) { return next(err); }
}

router.use(authenticate);
router.use(orgScope);
// Scheduled rows are consumed by the install-level scheduler from the primary
// database. Keep their API on that same canonical store even when the active
// organization uses an isolated tenant database.
router.use((req, _res, next) => {
  if (typeof db.withPrimaryContext === 'function') {
    return db.withPrimaryContext(() => next());
  }
  return next();
});

// ---------------------------------------------------------------------------
// Org scoping (j36)
// ---------------------------------------------------------------------------
// ScheduledTask declares hasOrgScope=false, and BaseModel omits the org
// predicate SILENTLY when it does — so list/get/update/delete ran unscoped and
// one tenant could see, edit and DELETE another tenant's scheduled jobs.
//
// It could not simply be flipped to true. Global system tasks are seeded with
// `SELECT NULL` for the org ON PURPOSE — data_retention, the config-backup
// pull, apply_late_fees, the TLS monitor — and a plain `organization_id = ?`
// would hide every one of them from every tenant, which is worse than the leak
// it fixes: the operator would believe nothing is scheduled.
//
// So it needs `organization_id = ? OR organization_id IS NULL`, which BaseModel
// cannot express. Same shape, and the same treatment, as the shared NULL-org
// tax rates in #566: READS admit the global rows and flag them, WRITES refuse
// them. A global task belongs to the install, not to whichever tenant found it
// first — one org disabling data_retention for everybody is exactly the kind of
// silent cross-tenant damage this job is about.

/** True when the target row is a global (NULL-org) task touched by a tenant. */
async function isGlobalTask(id) {
  const [rows] = await db.query(
    'SELECT organization_id FROM scheduled_tasks WHERE id = ? LIMIT 1',
    [id],
  );
  return rows.length > 0 && rows[0].organization_id === null;
}

/**
 * Refuse writes to a GLOBAL (NULL-org) task.
 *
 * This guard answers exactly one question — "is the target global?" — and
 * nothing else. It is NOT a tenancy check: a task owned by ANOTHER
 * organization is not global, so this waves it through by design. Strict
 * ownership is BaseModel's job, via ScheduledTask.hasOrgScope, and that is
 * the half #582 was missing: with the flag false, "not global" meant "no
 * predicate at all" and one tenant could edit another tenant's task.
 *
 * Keeping the two concerns separate is deliberate. Folding ownership in here
 * would put tenancy enforcement in a route helper for one table, where the
 * next table would have to reimplement it; leaving it in the model means every
 * verb — update, delete, restore — gets it without being asked.
 */
function blockGlobalTaskWrites(req, res, next) {
  isGlobalTask(req.params.id)
    .then((global) => {
      if (!global) return next();   // may still be another org's — see above
      res.status(403).json({
        error: {
          code: 'GLOBAL_TASK_READONLY',
          message: 'This is a system task shared by every organization on this install — it cannot be changed or deleted from one organization.',
        },
      });
    })
    .catch(next);
}

/**
 * organization_id is in `fillable` because crudController injects it on
 * create. That also means a PUT body carrying one would reach
 * BaseModel.update, and the update schema does not declare the field, so
 * validate() lets it pass rather than rejecting it (undeclared fields are
 * ignored, not stripped).
 *
 * The result would be a task MOVED into another tenant — or, worse, into NULL
 * and thereby promoted to a global task that every org then sees and nobody
 * can edit. Same hole that was closed for invoices with ORG_IMMUTABLE.
 */
function rejectOrgReassignment(req, res, next) {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'organization_id')) {
    return res.status(422).json({
      error: {
        code: 'ORG_IMMUTABLE',
        message: 'A scheduled task cannot be moved to another organization.',
      },
    });
  }
  next();
}

router.get('/', requirePermission('scheduled_tasks.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const conditions = ['(organization_id = ? OR organization_id IS NULL)'];
    const params = [req.orgId];
    if (req.query.is_enabled !== undefined) {
      conditions.push('is_enabled = ?');
      params.push(req.query.is_enabled === 'true' || req.query.is_enabled === '1' ? 1 : 0);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await db.query(
      `SELECT scheduled_tasks.*, (organization_id IS NULL) AS is_global
         FROM scheduled_tasks ${where}
        ORDER BY is_global ASC, id ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM scheduled_tasks ${where}`, params,
    );
    res.json({ data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('scheduled_tasks.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT scheduled_tasks.*, (organization_id IS NULL) AS is_global
         FROM scheduled_tasks
        WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scheduled task not found' } });
    }
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('scheduled_tasks.create'), requireInstallOperator, quotaCheck('scheduled_tasks'), validate(createScheduledTask), ctrl.create);
router.put('/:id', requirePermission('scheduled_tasks.update'), requireInstallOperator, blockGlobalTaskWrites, rejectOrgReassignment, validate(updateScheduledTask), ctrl.update);
router.delete('/:id', requirePermission('scheduled_tasks.delete'), requireInstallOperator, blockGlobalTaskWrites, ctrl.destroy);

// Manually trigger a task
router.post('/:id/run', requirePermission('scheduled_tasks.update'), async (req, res, next) => {
  try {
    // findByIdOrFail with no org argument read ANY task by id, so a tenant
    // could trigger another tenant's job by guessing. Keep the scoped lookup
    // even though manual execution itself is install-operator-only below.
    const [taskRows] = await db.query(
      'SELECT * FROM scheduled_tasks WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) LIMIT 1',
      [req.params.id, req.orgId],
    );
    const task = taskRows[0];
    if (!task) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scheduled task not found' } });

    // Task names select executable handlers, and an org-owned row can carry the
    // same name as a global retention, backup, campaign, or DR handler. Gating
    // only NULL-org rows would therefore be bypassable by creating/renaming an
    // org row. Manual execution is an operator diagnostic action for every row;
    // CRUD is operator-only for the same reason (an enabled row is executable).
    if (!await isInstallOperator(req)) {
      return res.status(403).json({
        error: { code: 'INSTALL_OPERATOR_ONLY', message: OPERATOR_ONLY_MESSAGE },
      });
    }

    const execute = async (selectedTask) => {
      const organizationId = selectedTask.organization_id === null
        ? null
        : Number(selectedTask.organization_id);
      await db.query(
        'UPDATE scheduled_tasks SET last_status = ?, last_run_at = NOW() WHERE id = ?',
        ['running', selectedTask.id],
      );
      try {
        const result = await taskRunner.runTask(selectedTask.task_name, organizationId);
        const completionStatus = result?.skipped === true && result?.reason === 'already_running'
          ? 'skipped'
          : 'success';
        await db.query(
          'UPDATE scheduled_tasks SET last_status = ?, last_run_at = NOW() WHERE id = ?',
          [completionStatus, selectedTask.id],
        );
        res.json({ data: { task_name: selectedTask.task_name, result } });
      } catch (err) {
        await db.query(
          'UPDATE scheduled_tasks SET last_status = ? WHERE id = ?',
          ['failed', selectedTask.id],
        ).catch(() => {});
        throw err;
      }
    };

    return await execute(task);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
