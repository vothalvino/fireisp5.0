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

const router = Router();
const ctrl = crudController(SatisfactionSurvey, { cacheResource: 'satisfaction-surveys' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('surveys.view'), ctrl.list);

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
