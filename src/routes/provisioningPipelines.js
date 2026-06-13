// =============================================================================
// FireISP 5.0 — Provisioning Pipelines Routes (§18.1)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const db = require('../config/database');
const automationService = require('../services/automationService');

const createPipelineSchema = {
  name:        { type: 'string', required: true, min: 1, max: 255 },
  contract_id: { type: 'number' },
  client_id:   { type: 'number' },
};

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /provisioning-pipelines
router.get('/', requirePermission('provisioning_pipelines.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];
    if (status) { conditions.push('status = ?'); params.push(status); }

    const [rows] = await db.query(
      `SELECT * FROM provisioning_pipelines WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset],
    );
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM provisioning_pipelines WHERE ${conditions.join(' AND ')}`, params);
    res.json({ data: rows, meta: { total: countResult[0].total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// GET /provisioning-pipelines/:id
router.get('/:id', requirePermission('provisioning_pipelines.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM provisioning_pipelines WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Pipeline not found' } });
    const pipeline = rows[0];

    const [stages] = await db.query(
      'SELECT * FROM provisioning_pipeline_stages WHERE pipeline_id = ? ORDER BY stage_order ASC',
      [pipeline.id],
    );
    res.json({ data: { ...pipeline, stages } });
  } catch (err) { next(err); }
});

// POST /provisioning-pipelines — trigger a pipeline run
router.post('/', requirePermission('provisioning_pipelines.create'), validate(createPipelineSchema), async (req, res, next) => {
  try {
    const pipeline = await automationService.runProvisioningPipeline(req.orgId, {
      name: req.body.name,
      contract_id: req.body.contract_id || null,
      client_id: req.body.client_id || null,
      triggered_by: req.user.id,
    });
    res.status(201).json({ data: pipeline });
  } catch (err) { next(err); }
});

module.exports = router;
