// =============================================================================
// FireISP 5.0 — Scheduled Reports Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /api/scheduled-reports
router.get('/', requirePermission('reports.schedule'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      `SELECT * FROM scheduled_reports
       WHERE organization_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/scheduled-reports/:id
router.get('/:id', requirePermission('reports.schedule'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      'SELECT * FROM scheduled_reports WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scheduled report not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/scheduled-reports
router.post('/', requirePermission('reports.schedule'), async (req, res, next) => {
  try {
    const {
      report_def_name,
      report_def_id = null,
      format = 'csv',
      parameters = null,
      recipients = null,
      cron_expression = '0 8 * * 1',
      is_enabled = 1,
    } = req.body;

    if (!report_def_name) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'report_def_name is required' } });
    }

    const [result] = await db.query(
      `INSERT INTO scheduled_reports
         (organization_id, report_def_id, report_def_name, format, parameters, recipients,
          cron_expression, is_enabled, created_by, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [req.orgId, report_def_id, report_def_name, format,
        parameters ? JSON.stringify(parameters) : null,
        recipients ? JSON.stringify(recipients) : null,
        cron_expression, is_enabled ? 1 : 0, req.user.id],
    );

    const [rows] = await db.queryReplica(
      'SELECT * FROM scheduled_reports WHERE id = ?',
      [result.insertId],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/scheduled-reports/:id
router.put('/:id', requirePermission('reports.schedule'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      'SELECT id FROM scheduled_reports WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scheduled report not found' } });

    const { format, parameters, recipients, cron_expression, is_enabled } = req.body;

    await db.query(
      `UPDATE scheduled_reports
       SET format = COALESCE(?, format),
           parameters = COALESCE(?, parameters),
           recipients = COALESCE(?, recipients),
           cron_expression = COALESCE(?, cron_expression),
           is_enabled = COALESCE(?, is_enabled),
           updated_at = NOW()
       WHERE id = ?`,
      [format ?? null,
        parameters !== undefined ? JSON.stringify(parameters) : null,
        recipients !== undefined ? JSON.stringify(recipients) : null,
        cron_expression ?? null,
        is_enabled !== undefined ? (is_enabled ? 1 : 0) : null,
        req.params.id],
    );

    const [rows] = await db.queryReplica(
      'SELECT * FROM scheduled_reports WHERE id = ?',
      [req.params.id],
    );
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/scheduled-reports/:id/run — manually trigger a schedule now (on-demand)
router.post('/:id/run', requirePermission('reports.generate'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      'SELECT * FROM scheduled_reports WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scheduled report not found' } });

    const schedule = rows[0];
    const { runOnDemand } = require('../services/scheduledReportService');
    const result = await runOnDemand({
      organizationId: req.orgId,
      reportDefName: schedule.report_def_name,
      format: schedule.format,
      parameters: schedule.parameters ? JSON.parse(schedule.parameters) : {},
      scheduledReportId: schedule.id,
      generatedBy: req.user.id,
    });

    const [genRows] = await db.queryReplica(
      'SELECT id, organization_id, scheduled_report_id, report_def_name, format, status, generated_at FROM generated_reports WHERE id = ?',
      [result.reportId],
    );
    res.status(202).json({ data: genRows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/scheduled-reports/:id
router.delete('/:id', requirePermission('reports.schedule'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      'SELECT id FROM scheduled_reports WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scheduled report not found' } });

    await db.query(
      'UPDATE scheduled_reports SET deleted_at = NOW() WHERE id = ?',
      [req.params.id],
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
