// =============================================================================
// FireISP 5.0 — Batch Jobs Routes (§18.1)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const db = require('../config/database');
const automationService = require('../services/automationService');

const createBatchJob = {
  name:             { type: 'string', required: true, min: 1, max: 255 },
  operation:        {
    type: 'string', required: true,
    enum: ['suspend','unsuspend','rate_limit','send_notification','apply_tag','remove_tag','change_plan','send_email','send_sms'],
  },
  filter_criteria:  { type: 'object', required: true },
  operation_params: { type: 'object' },
};

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /batch-jobs
router.get('/', requirePermission('batch_jobs.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status, operation } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];
    if (status)    { conditions.push('status = ?');    params.push(status); }
    if (operation) { conditions.push('operation = ?'); params.push(operation); }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT * FROM batch_jobs WHERE ${where} ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM batch_jobs WHERE ${where}`, params);
    res.json({ data: rows, meta: { total: countResult[0].total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// GET /batch-jobs/:id
router.get('/:id', requirePermission('batch_jobs.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM batch_jobs WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Batch job not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// GET /batch-jobs/:id/items
router.get('/:id/items', requirePermission('batch_jobs.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 100, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 200);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['batch_job_id = ? AND organization_id = ?'];
    const params = [req.params.id, req.orgId];
    if (status) { conditions.push('status = ?'); params.push(status); }

    const [rows] = await db.query(
      `SELECT * FROM batch_job_items WHERE ${conditions.join(' AND ')} ORDER BY id ASC LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM batch_job_items WHERE ${conditions.join(' AND ')}`, params);
    res.json({ data: rows, meta: { total: countResult[0].total } });
  } catch (err) { next(err); }
});

// POST /batch-jobs
router.post('/', requirePermission('batch_jobs.create'), validate(createBatchJob), async (req, res, next) => {
  try {
    const job = await automationService.createBatchJob(req.orgId, {
      ...req.body,
      created_by: req.user.id,
    });
    res.status(201).json({ data: job });
  } catch (err) { next(err); }
});

// POST /batch-jobs/:id/cancel
router.post('/:id/cancel', requirePermission('batch_jobs.cancel'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT id FROM batch_jobs WHERE id = ? AND organization_id = ? AND status IN ('pending','running')",
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Batch job not found or not cancellable' } });
    await db.query("UPDATE batch_jobs SET status = 'cancelled', completed_at = NOW() WHERE id = ?", [req.params.id]);
    const [updated] = await db.query('SELECT * FROM batch_jobs WHERE id = ?', [req.params.id]);
    res.json({ data: updated[0] });
  } catch (err) { next(err); }
});

module.exports = router;
