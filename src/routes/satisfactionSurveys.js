// =============================================================================
// FireISP 5.0 — Satisfaction Survey Routes (NPS / CSAT) (§1.3)
// =============================================================================

const { Router } = require('express');
const SatisfactionSurvey = require('../models/SatisfactionSurvey');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSurvey, updateSurvey, patchSurvey, respondSurvey } = require('../middleware/schemas/interactions');
const interactionService = require('../services/interactionService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(SatisfactionSurvey, { cacheResource: 'satisfaction-surveys' });

router.use(authenticate);
router.use(orgScope);

// List surveys with the client NAME joined in (so the UI never shows a bare
// client_id) plus pagination/filter.
router.get('/', requirePermission('surveys.view'), async (req, res, next) => {
  try {
    const { status, survey_type, page = 1, limit = 50, order_by, order, include_deleted } = req.query;
    const conditions = [];
    const params = [];
    if (include_deleted !== 'true') conditions.push('s.deleted_at IS NULL');
    if (req.orgId) { conditions.push('s.organization_id = ?'); params.push(req.orgId); }
    if (status) { conditions.push('s.status = ?'); params.push(status); }
    if (survey_type) { conditions.push('s.survey_type = ?'); params.push(survey_type); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const ORDER_COLS = { id: 's.id', created_at: 's.created_at', sent_at: 's.sent_at', status: 's.status', client_name: 'client_name' };
    const orderCol = ORDER_COLS[order_by] || 's.created_at';
    const orderDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `SELECT s.*, cl.name AS client_name
       FROM satisfaction_surveys s
       JOIN clients cl ON cl.id = s.client_id
       ${where}
       ORDER BY ${orderCol} ${orderDir}
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM satisfaction_surveys s JOIN clients cl ON cl.id = s.client_id ${where}`,
      params,
    );
    res.json({ data: rows, meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) } });
  } catch (err) { next(err); }
});

// Aggregate NPS / CSAT metrics — must precede '/:id'
router.get('/metrics', requirePermission('surveys.view'), async (req, res, next) => {
  try {
    const report = await interactionService.surveyMetrics(req.orgId, { months: req.query.months });
    res.json({ data: report });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('surveys.view'), ctrl.get);
router.post('/', requirePermission('surveys.create'), validate(createSurvey), ctrl.create);
router.put('/:id', requirePermission('surveys.update'), validate(updateSurvey), ctrl.update);
router.patch('/:id', requirePermission('surveys.update'), validate(patchSurvey), ctrl.partialUpdate);
router.delete('/:id', requirePermission('surveys.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('surveys.update'), ctrl.restore);

// Send (or re-send) a survey to the client
router.post('/:id/send', requirePermission('surveys.create'), async (req, res, next) => {
  try {
    const survey = await interactionService.sendSurvey(req.params.id, req.orgId);
    res.json({ data: survey });
  } catch (err) { next(err); }
});

// Record the client's response (NPS: 0-10, CSAT: 1-5)
router.post('/:id/respond', requirePermission('surveys.update'), validate(respondSurvey), async (req, res, next) => {
  try {
    const survey = await interactionService.respondSurvey(req.params.id, req.orgId, {
      score: req.body.score,
      comment: req.body.comment,
    });
    res.json({ data: survey });
  } catch (err) { next(err); }
});

module.exports = router;
