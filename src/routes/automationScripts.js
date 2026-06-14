// =============================================================================
// FireISP 5.0 — Automation Scripts Routes (§18.2)
// =============================================================================
// SECURITY: Script execution is STUBBED. No child_process calls anywhere here.
// The execute endpoint creates a 'queued' record — a sandboxed executor is out of scope.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const scriptingService = require('../services/scriptingService');
const db = require('../config/database');

const createScriptSchema = {
  name:               { type: 'string', required: true, min: 1, max: 255 },
  description:        { type: 'string' },
  language:           { type: 'string', required: true, enum: ['bash','python','powershell','javascript'] },
  script_body:        { type: 'string', required: true, min: 1 },
  is_shared:          { type: 'boolean' },
  tags:               { type: 'object' },
  scheduled_task_id:  { type: 'number' },
  api_endpoint:       { type: 'string', max: 500 },
};

const updateScriptSchema = {
  name:               { type: 'string', min: 1, max: 255 },
  description:        { type: 'string' },
  language:           { type: 'string', enum: ['bash','python','powershell','javascript'] },
  script_body:        { type: 'string', min: 1 },
  is_shared:          { type: 'boolean' },
  tags:               { type: 'object' },
  scheduled_task_id:  { type: 'number' },
  api_endpoint:       { type: 'string', max: 500 },
};

const executeScriptSchema = {
  input_params: { type: 'object' },
};

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /automation-scripts
router.get('/', requirePermission('automation_scripts.view'), async (req, res, next) => {
  try {
    const { page, limit, language, is_shared } = req.query;
    const result = await scriptingService.listScripts(req.orgId, { page, limit, language, is_shared });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /automation-scripts/:id
router.get('/:id', requirePermission('automation_scripts.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM automation_scripts WHERE id = ? AND (organization_id = ? OR is_shared = 1) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Script not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /automation-scripts — admin only (enforced by permission)
router.post('/', requirePermission('automation_scripts.create'), validate(createScriptSchema), async (req, res, next) => {
  try {
    const script = await scriptingService.createScript(req.orgId, req.body, req.user.id);
    res.status(201).json({ data: script });
  } catch (err) { next(err); }
});

// PUT /automation-scripts/:id
router.put('/:id', requirePermission('automation_scripts.update'), validate(updateScriptSchema), async (req, res, next) => {
  try {
    const script = await scriptingService.updateScript(req.params.id, req.orgId, req.body);
    if (!script) return res.status(404).json({ error: { message: 'Script not found' } });
    res.json({ data: script });
  } catch (err) { next(err); }
});

// DELETE /automation-scripts/:id
router.delete('/:id', requirePermission('automation_scripts.delete'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id FROM automation_scripts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Script not found' } });
    await db.query('UPDATE automation_scripts SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /automation-scripts/:id/execute
// Script execution requires a sandboxed executor (SCRIPT_EXECUTION_ENABLED=true).
// Returns 501 when the execution engine is not enabled.
router.post('/:id/execute', requirePermission('automation_scripts.execute'), validate(executeScriptSchema), async (req, res, next) => {
  try {
    const execution = await scriptingService.executeScript(req.params.id, req.orgId, {
      input_params: req.body.input_params,
      triggered_by: req.user.id,
    });
    if (!execution) return res.status(404).json({ error: { message: 'Script not found' } });
    res.status(202).json({ data: execution });
  } catch (err) {
    if (err.statusCode === 501 || err.code === 'SCRIPT_EXECUTION_NOT_ENABLED') {
      return res.status(501).json({ error: { message: err.message, code: err.code } });
    }
    next(err);
  }
});

// GET /automation-scripts/executions — list executions for org
router.get('/executions/list', requirePermission('script_executions.view'), async (req, res, next) => {
  try {
    const { script_id, status, page, limit } = req.query;
    const result = await scriptingService.listExecutions(req.orgId, { script_id, status, page, limit });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /automation-scripts/:id/executions — list executions for a specific script
router.get('/:id/executions', requirePermission('script_executions.view'), async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const result = await scriptingService.listExecutions(req.orgId, { script_id: req.params.id, status, page, limit });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
