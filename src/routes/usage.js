// =============================================================================
// FireISP 5.0 — Data Usage Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const usageService = require('../services/usageService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /api/usage/client/:clientId — usage summary for a client
router.get('/client/:clientId', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const data = await usageService.getClientUsage(req.params.clientId, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/usage/contract/:contractId/daily — daily breakdown
router.get('/contract/:contractId/daily', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const data = await usageService.getDailyUsage(req.params.contractId, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/usage/top — top bandwidth users
router.get('/top', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const data = await usageService.getTopUsers(req.orgId, {
      from: req.query.from,
      to: req.query.to,
      limit: parseInt(req.query.limit, 10) || 20,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/usage/data-caps — contracts over their data cap
router.get('/data-caps', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const data = await usageService.checkDataCaps(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

module.exports = router;
