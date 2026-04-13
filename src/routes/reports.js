// =============================================================================
// FireISP 5.0 — Report Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const reportService = require('../services/reportService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /api/reports/aging — Accounts Receivable Aging
router.get('/aging', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const data = await reportService.agingReport(req.orgId, {
      currency: req.query.currency,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/financial — Financial Summary
router.get('/financial', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const data = await reportService.financialSummary(req.orgId, {
      from: req.query.from,
      to: req.query.to,
      currency: req.query.currency,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/technicians — Technician Productivity
router.get('/technicians', requirePermission('audit_logs.view'), async (req, res, next) => {
  try {
    const data = await reportService.technicianReport(req.orgId, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/subscriber-growth — Subscriber Growth
router.get('/subscriber-growth', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const data = await reportService.subscriberGrowthReport(req.orgId, {
      months: parseInt(req.query.months, 10) || 12,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

module.exports = router;
