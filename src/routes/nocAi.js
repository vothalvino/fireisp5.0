// =============================================================================
// FireISP 5.0 — NOC AI Routes (§21.11)
// =============================================================================
// Mounted at /api/v1/noc-ai
//
// Endpoints:
//   GET  /insights                    list recent NOC AI insights
//   POST /insights/alert-explain      explain an alert with AI
//   POST /insights/capacity-warning   run capacity warning analysis
//   POST /insights/interference       run interference detection
//   POST /insights/alignment-drift    run alignment drift detection
//   POST /insights/shift-summary      generate shift summary
//   POST /insights/runbook            get runbook suggestion
// =============================================================================
'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { explainAlert: explainAlertSchema, runbookSuggestion: runbookSchema } = require('../middleware/schemas/nocAi');
const nocAiService = require('../services/nocAiService');
const { NotFoundError } = require('../utils/errors');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /noc-ai/insights
router.get(
  '/insights',
  requirePermission('noc_ai.read'),
  async (req, res, next) => {
    try {
      const insights = await nocAiService.listInsights(req.orgId, req.query);
      res.json({ data: insights, total: insights.length });
    } catch (err) {
      next(err);
    }
  },
);

// POST /noc-ai/insights/alert-explain
router.post(
  '/insights/alert-explain',
  requirePermission('noc_ai.analyze'),
  validate(explainAlertSchema),
  async (req, res, next) => {
    try {
      const result = await nocAiService.explainAlert(req.orgId, req.body.alertId, req.body.providerId);
      res.json({ data: result });
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

// POST /noc-ai/insights/capacity-warning
router.post(
  '/insights/capacity-warning',
  requirePermission('noc_ai.analyze'),
  async (req, res, next) => {
    try {
      const result = await nocAiService.capacityWarning(req.orgId, req.body?.providerId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /noc-ai/insights/interference
router.post(
  '/insights/interference',
  requirePermission('noc_ai.analyze'),
  async (req, res, next) => {
    try {
      const result = await nocAiService.detectInterference(req.orgId, req.body?.providerId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /noc-ai/insights/alignment-drift
router.post(
  '/insights/alignment-drift',
  requirePermission('noc_ai.analyze'),
  async (req, res, next) => {
    try {
      const result = await nocAiService.alignmentDrift(req.orgId, req.body?.providerId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /noc-ai/insights/shift-summary
router.post(
  '/insights/shift-summary',
  requirePermission('noc_ai.analyze'),
  async (req, res, next) => {
    try {
      const result = await nocAiService.shiftSummary(req.orgId, req.body?.providerId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /noc-ai/insights/runbook
router.post(
  '/insights/runbook',
  requirePermission('noc_ai.analyze'),
  validate(runbookSchema),
  async (req, res, next) => {
    try {
      const result = await nocAiService.runbookSuggestion(req.orgId, req.body.alertType, req.body.providerId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
