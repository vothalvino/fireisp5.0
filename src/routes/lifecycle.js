// =============================================================================
// FireISP 5.0 — Customer Lifecycle Analytics Routes — §1.2
// =============================================================================
// Churn analytics and predictive at-risk (churn) alerts.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const lifecycleService = require('../services/lifecycleService');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// Monthly churn report
router.get('/churn', requirePermission('lifecycle.view'), async (req, res, next) => {
  try {
    const report = await lifecycleService.churnReport(req.orgId, { months: req.query.months });
    res.json({ data: report });
  } catch (err) { next(err); }
});

// Predictive churn alerts — clients at risk
router.get('/at-risk', requirePermission('lifecycle.view'), async (req, res, next) => {
  try {
    const report = await lifecycleService.atRiskClients(req.orgId, { limit: req.query.limit });
    res.json({ data: report });
  } catch (err) { next(err); }
});

module.exports = router;
