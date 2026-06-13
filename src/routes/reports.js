// =============================================================================
// FireISP 5.0 — Report Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { httpCache } = require('../middleware/httpCache');
const reportService = require('../services/reportService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /api/reports/aging — Accounts Receivable Aging
router.get('/aging', requirePermission('invoices.view'), httpCache('report_aging', 300), async (req, res, next) => {
  try {
    const data = await reportService.agingReport(req.orgId, {
      currency: req.query.currency,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/financial — Financial Summary
router.get('/financial', requirePermission('invoices.view'), httpCache('report_financial', 300), async (req, res, next) => {
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

// ============================================================================
// §15.1 Financial Reports
// ============================================================================

// GET /api/reports/revenue-by-period
router.get('/revenue-by-period', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.revenueByPeriod(req.orgId, {
      period: req.query.period || 'monthly',
      from: req.query.from,
      to: req.query.to,
      currency: req.query.currency,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/revenue-by-plan
router.get('/revenue-by-plan', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.revenueByPlan(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/revenue-by-region
router.get('/revenue-by-region', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.revenueByRegion(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/revenue-by-agent
router.get('/revenue-by-agent', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.revenueByAgent(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/cash-flow
router.get('/cash-flow', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.cashFlowReport(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/payment-methods
router.get('/payment-methods', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.paymentMethodBreakdown(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/churn-revenue
router.get('/churn-revenue', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.churnRevenueImpact(req.orgId, {
      months: parseInt(req.query.months, 10) || 12,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/agent-commissions
router.get('/agent-commissions', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.agentCommissions(req.orgId, {
      from: req.query.from,
      to: req.query.to,
      rate: parseFloat(req.query.rate) || 0.05,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/tax-summary
router.get('/tax-summary', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.taxSummary(req.orgId, {
      from: req.query.from,
      to: req.query.to,
      currency: req.query.currency,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/sat-export
router.get('/sat-export', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.satExport(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// ============================================================================
// §15.2 Operational Reports
// ============================================================================

// GET /api/reports/subscriber-counts
router.get('/subscriber-counts', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.subscriberCounts(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/arpu
router.get('/arpu', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.arpuReport(req.orgId, {
      months: parseInt(req.query.months, 10) || 12,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/bandwidth-utilization
router.get('/bandwidth-utilization', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.bandwidthUtilization(req.orgId, {
      days: parseInt(req.query.days, 10) || 30,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/top-consumers
router.get('/top-consumers', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.topConsumers(req.orgId, {
      days: parseInt(req.query.days, 10) || 30,
      limit: parseInt(req.query.limit, 10) || 10,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/uptime-by-area
router.get('/uptime-by-area', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.uptimeByArea(req.orgId, {
      days: parseInt(req.query.days, 10) || 30,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/mttr
router.get('/mttr', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.mttrReport(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/installation-completion
router.get('/installation-completion', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.installationCompletion(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// ============================================================================
// §15.3 Network Reports
// ============================================================================

// GET /api/reports/congested-links
router.get('/congested-links', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.congestedLinks(req.orgId, {
      days: parseInt(req.query.days, 10) || 7,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/sfp-lifespan
router.get('/sfp-lifespan', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.sfpLifespan(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/optical-degradation
router.get('/optical-degradation', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.opticalDegradation(req.orgId, {
      days: parseInt(req.query.days, 10) || 30,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/device-reboots
router.get('/device-reboots', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.deviceReboots(req.orgId, {
      days: parseInt(req.query.days, 10) || 30,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/snmp-poll-success
router.get('/snmp-poll-success', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.snmpPollSuccess(req.orgId, {
      days: parseInt(req.query.days, 10) || 7,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/alert-frequency
router.get('/alert-frequency', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.alertFrequency(req.orgId, {
      days: parseInt(req.query.days, 10) || 30,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/capacity-forecast
router.get('/capacity-forecast', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.capacityForecast(req.orgId, {
      months: parseInt(req.query.months, 10) || 6,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/pon-utilization
router.get('/pon-utilization', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.ponUtilization(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// ============================================================================
// §15.4 Compliance Reports
// ============================================================================

// GET /api/reports/data-retention-compliance
router.get('/data-retention-compliance', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.dataRetentionCompliance(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/ip-assignment-log
router.get('/ip-assignment-log', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.ipAssignmentLog(req.orgId, {
      from: req.query.from,
      to: req.query.to,
      ip_address: req.query.ip_address,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/subscriber-identity
router.get('/subscriber-identity', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.subscriberIdentity(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/interception-readiness
router.get('/interception-readiness', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.interceptionReadiness(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/reports/regulatory-export
router.get('/regulatory-export', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const data = await reportService.regulatoryExport(req.orgId, { from: req.query.from, to: req.query.to });
    res.json({ data });
  } catch (err) { next(err); }
});

// ============================================================================
// §15.5 On-demand Report Generation
// ============================================================================

const { formatReport, generateReportData, runOnDemand } = require('../services/scheduledReportService');

// POST /api/reports/generate — trigger an on-demand report, record in generated_reports
router.post('/generate', requirePermission('reports.generate'), async (req, res, next) => {
  try {
    const { report_def_name, format = 'csv', parameters = {} } = req.body;

    if (!report_def_name) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'report_def_name is required' } });
    }
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'format must be csv, xlsx, or pdf' } });
    }

    const result = await runOnDemand({
      organizationId: req.orgId,
      reportDefName: report_def_name,
      format,
      parameters,
      scheduledReportId: null,
      generatedBy: req.user.id,
    });

    const [rows] = await require('../config/database').queryReplica(
      'SELECT id, organization_id, report_def_name, format, status, generated_at FROM generated_reports WHERE id = ?',
      [result.reportId],
    );
    res.status(202).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================================
// §15.5 Generic Export endpoint — must be LAST to avoid catching named routes
// ============================================================================

// GET /api/reports/:report/export?format=csv|xlsx|pdf
router.get('/:report/export', requirePermission('reports.export'), async (req, res, next) => {
  try {
    const { report } = req.params;
    const format = (req.query.format || 'csv').toLowerCase();

    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'format must be csv, xlsx, or pdf' } });
    }

    // Dispatch to reportService
    const params = {
      from: req.query.from,
      to: req.query.to,
      months: req.query.months ? parseInt(req.query.months, 10) : undefined,
      days: req.query.days ? parseInt(req.query.days, 10) : undefined,
      period: req.query.period,
      currency: req.query.currency,
    };

    const data = await generateReportData(req.orgId, report, params);
    const { buffer, contentType, extension } = await formatReport(data, report, format);

    const filename = `${report}-${new Date().toISOString().slice(0, 10)}.${extension}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

module.exports = router;
