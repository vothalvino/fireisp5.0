'use strict';

// =============================================================================
// FireISP 5.0 — OLT Management Routes (§7.1 / §7.3)
// =============================================================================
// Mounted at /api/olt-management and /api/v1/olt-management.
//
// Resources:
//   OLT devices    — CRUD via the existing /devices endpoint (type=olt).
//                    This router provides FTTH-specific sub-resources:
//   /:id/ports         — OLT port inventory (nested under OLT device)
//   /:id/chassis       — Latest SNMP chassis metrics (CPU/mem/temp)
//   /:id/onus          — ONUs visible on this OLT
//   /:id/vendor-caps   — Vendor capability record for this OLT
//   /ports             — Global OLT port CRUD (org-scoped)
//   /ports/:portId/utilization  — PON port utilization dashboard (§7.3)
//   /ports/:portId/onus         — ONUs per port with active/inactive filter (§7.3)
//   /ports/:portId/shutdown     — Set/clear maintenance mode (§7.3)
//   /ports/:portId/xgspon-mode  — Configure XGS-PON sub-mode (§7.3)
//   /power-budget               — Optical power budget calculator (§7.3)
//   /onu-migrations             — ONU port migration jobs CRUD (§7.3)
//   /splitters                  — Splitter inventory CRUD (org-scoped)
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createOltPort, updateOltPort, patchOltPort,
} = require('../middleware/schemas/oltPorts');
const {
  createOltSplitter, updateOltSplitter, patchOltSplitter,
} = require('../middleware/schemas/oltSplitters');
const {
  createOnuMigrationJob, patchOnuMigrationJob,
} = require('../middleware/schemas/onuMigrationJobs');
const ftthService = require('../services/ftthService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// OLT Device sub-resources (FTTH-specific views layered over existing devices)
// ---------------------------------------------------------------------------

/**
 * GET /:id/ports — list PON/uplink ports for an OLT
 */
router.get('/:id/ports', requirePermission('olt_ports.view'), async (req, res, next) => {
  try {
    const ports = await ftthService.getOltPorts(req.params.id, req.orgId);
    res.json({ data: ports });
  } catch (err) { next(err); }
});

/**
 * POST /:id/ports — create a port record for an OLT
 */
router.post('/:id/ports', requirePermission('olt_ports.create'), validate(createOltPort), async (req, res, next) => {
  try {
    // Verify the device exists and belongs to org
    const [devRows] = await db.query(
      'SELECT id, type FROM devices WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!devRows.length) return res.status(404).json({ error: 'OLT device not found' });
    if (devRows[0].type !== 'olt') return res.status(400).json({ error: 'Device is not an OLT' });

    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO olt_ports SET ?',
      [{ organization_id: req.orgId, olt_device_id: req.params.id, ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM olt_ports WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * GET /:id/chassis — latest SNMP chassis metrics for an OLT
 */
router.get('/:id/chassis', requirePermission('olt_management.view'), async (req, res, next) => {
  try {
    const summary = await ftthService.getOltChassisSummary(req.params.id);
    res.json({ data: summary });
  } catch (err) { next(err); }
});

/**
 * GET /:id/onus — list ONUs registered on this OLT
 */
router.get('/:id/onus', requirePermission('onu_management.view'), async (req, res, next) => {
  try {
    const { state, port_id: portId } = req.query;
    const onus = await ftthService.getOnusForOlt(req.params.id, req.orgId, { state, portId });
    res.json({ data: onus });
  } catch (err) { next(err); }
});

/**
 * GET /:id/vendor-caps — vendor capability record for this OLT's manufacturer/model
 */
router.get('/:id/vendor-caps', requirePermission('olt_management.view'), async (req, res, next) => {
  try {
    const [devRows] = await db.query(
      'SELECT manufacturer, model FROM devices WHERE id = ? AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!devRows.length) return res.status(404).json({ error: 'OLT device not found' });

    const { manufacturer, model } = devRows[0];
    const [caps] = await db.query(
      'SELECT * FROM olt_vendor_capabilities WHERE vendor = ? AND ? LIKE model_pattern ORDER BY id LIMIT 1',
      [manufacturer, model || ''],
    );
    res.json({ data: caps[0] || null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// OLT Ports — standalone CRUD
// ---------------------------------------------------------------------------

/**
 * GET /ports — list all OLT ports for org
 */
router.get('/ports', requirePermission('olt_ports.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, olt_device_id, port_type, oper_status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT p.*, d.name AS olt_name FROM olt_ports p JOIN devices d ON d.id = p.olt_device_id WHERE (p.organization_id = ? OR p.organization_id IS NULL) AND p.deleted_at IS NULL';
    const params = [req.orgId];

    if (olt_device_id) { sql += ' AND p.olt_device_id = ?'; params.push(olt_device_id); }
    if (port_type) { sql += ' AND p.port_type = ?'; params.push(port_type); }
    if (oper_status) { sql += ' AND p.oper_status = ?'; params.push(oper_status); }

    const countSql = sql.replace('SELECT p.*, d.name AS olt_name', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY p.olt_device_id ASC, p.slot_no ASC, p.port_no ASC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /ports/:portId — single OLT port
 */
router.get('/ports/:portId', requirePermission('olt_ports.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM olt_ports WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.portId, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PUT /ports/:portId — update OLT port
 */
router.put('/ports/:portId', requirePermission('olt_ports.update'), validate(updateOltPort), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM olt_ports WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.portId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, olt_device_id: _____, ...updateData } = req.body;
    await db.query('UPDATE olt_ports SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.portId]);
    const [rows] = await db.query('SELECT * FROM olt_ports WHERE id = ?', [req.params.portId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PATCH /ports/:portId — partial update OLT port
 */
router.patch('/ports/:portId', requirePermission('olt_ports.update'), validate(patchOltPort), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM olt_ports WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.portId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, olt_device_id: _____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    await db.query('UPDATE olt_ports SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.portId]);
    const [rows] = await db.query('SELECT * FROM olt_ports WHERE id = ?', [req.params.portId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /ports/:portId — soft-delete OLT port
 */
router.delete('/ports/:portId', requirePermission('olt_ports.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM olt_ports WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.portId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE olt_ports SET deleted_at = NOW() WHERE id = ?', [req.params.portId]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Splitters CRUD
// ---------------------------------------------------------------------------

/**
 * GET /splitters — list splitters for org
 */
router.get('/splitters', requirePermission('olt_splitters.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status, ratio } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM olt_splitters WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL';
    const params = [req.orgId];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (ratio) { sql += ' AND ratio = ?'; params.push(ratio); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /splitters/:splitterId — single splitter
 */
router.get('/splitters/:splitterId', requirePermission('olt_splitters.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM olt_splitters WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.splitterId, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * POST /splitters — create splitter
 */
router.post('/splitters', requirePermission('olt_splitters.create'), validate(createOltSplitter), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO olt_splitters SET ?',
      [{ organization_id: req.orgId, ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM olt_splitters WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PUT /splitters/:splitterId — full update
 */
router.put('/splitters/:splitterId', requirePermission('olt_splitters.update'), validate(updateOltSplitter), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM olt_splitters WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.splitterId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    await db.query('UPDATE olt_splitters SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.splitterId]);
    const [rows] = await db.query('SELECT * FROM olt_splitters WHERE id = ?', [req.params.splitterId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PATCH /splitters/:splitterId — partial update
 */
router.patch('/splitters/:splitterId', requirePermission('olt_splitters.update'), validate(patchOltSplitter), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM olt_splitters WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.splitterId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    await db.query('UPDATE olt_splitters SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.splitterId]);
    const [rows] = await db.query('SELECT * FROM olt_splitters WHERE id = ?', [req.params.splitterId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /splitters/:splitterId — soft-delete splitter
 */
router.delete('/splitters/:splitterId', requirePermission('olt_splitters.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM olt_splitters WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.splitterId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE olt_splitters SET deleted_at = NOW() WHERE id = ?', [req.params.splitterId]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// §7.3 PON Port Management — utilization, ONU lists, shutdown, XGS-PON mode
// ===========================================================================

/**
 * GET /ports/:portId/utilization — PON port utilization dashboard
 */
router.get('/ports/:portId/utilization', requirePermission('olt_ports.utilization'), async (req, res, next) => {
  try {
    const data = await ftthService.getPortUtilization(req.params.portId, req.orgId);
    if (!data) return res.status(404).json({ error: 'OLT port not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * GET /ports/:portId/onus — active/inactive ONU list per PON port
 */
router.get('/ports/:portId/onus', requirePermission('olt_ports.utilization'), async (req, res, next) => {
  try {
    const { state } = req.query;
    const onus = await ftthService.getOnusForPort(req.params.portId, req.orgId, state || null);
    res.json({ data: onus });
  } catch (err) { next(err); }
});

/**
 * POST /power-budget — optical power budget calculator (pure calculation)
 */
router.post('/power-budget', requirePermission('olt_ports.power_budget'), async (req, res, next) => {
  try {
    const {
      olt_tx_power_dbm: oltTxPowerDbm,
      splitter_ratio: splitterRatio,
      fiber_length_m: fiberLengthM,
      attenuation_per_km_db: attenuationPerKmDb,
      connector_margin_db: connectorMarginDb,
    } = req.body;

    if (oltTxPowerDbm === null || oltTxPowerDbm === undefined || !splitterRatio || fiberLengthM === null || fiberLengthM === undefined) {
      return res.status(400).json({ error: 'olt_tx_power_dbm, splitter_ratio, and fiber_length_m are required' });
    }

    const result = ftthService.calculatePowerBudget({
      oltTxPowerDbm: Number(oltTxPowerDbm),
      splitterRatio,
      fiberLengthM: Number(fiberLengthM),
      attenuationPerKmDb: attenuationPerKmDb !== null && attenuationPerKmDb !== undefined ? Number(attenuationPerKmDb) : undefined,
      connectorMarginDb: connectorMarginDb !== null && connectorMarginDb !== undefined ? Number(connectorMarginDb) : undefined,
    });

    res.json({ data: result });
  } catch (err) { next(err); }
});

/**
 * POST /ports/:portId/shutdown — set or clear maintenance mode on a PON port
 */
router.post('/ports/:portId/shutdown', requirePermission('olt_ports.shutdown'), async (req, res, next) => {
  try {
    const { enable = true, note } = req.body;
    const port = await ftthService.setPortMaintenanceMode(
      req.params.portId,
      Boolean(enable),
      note || null,
      req.user && req.user.id,
      req.orgId,
    );
    res.json({ data: port });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

/**
 * POST /ports/:portId/xgspon-mode — configure XGS-PON sub-mode on a port
 */
router.post('/ports/:portId/xgspon-mode', requirePermission('olt_ports.configure_mode'), async (req, res, next) => {
  try {
    const { mode } = req.body;
    if (!mode) return res.status(400).json({ error: 'mode is required' });
    const port = await ftthService.configurePortXgsPonMode(req.params.portId, mode, req.orgId);
    res.json({ data: port });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ===========================================================================
// §7.3 ONU Migration Jobs
// ===========================================================================

/**
 * GET /onu-migrations — list ONU migration jobs for org
 */
router.get('/onu-migrations', requirePermission('onu_migration_jobs.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status, onu_device_id } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = `SELECT j.*,
        src.port_name AS source_port_name,
        tgt.port_name AS target_port_name,
        d.name AS onu_name
      FROM onu_migration_jobs j
      LEFT JOIN olt_ports src ON src.id = j.source_olt_port_id
      LEFT JOIN olt_ports tgt ON tgt.id = j.target_olt_port_id
      LEFT JOIN devices d ON d.id = j.onu_device_id
      WHERE (j.organization_id = ? OR j.organization_id IS NULL) AND j.deleted_at IS NULL`;
    const params = [req.orgId];

    if (status) { sql += ' AND j.status = ?'; params.push(status); }
    if (onu_device_id) { sql += ' AND j.onu_device_id = ?'; params.push(onu_device_id); }

    const countSql = sql.replace(/SELECT j\.\*[\s\S]*?FROM/, 'SELECT COUNT(*) AS total FROM');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY j.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /onu-migrations/:jobId — single ONU migration job
 */
router.get('/onu-migrations/:jobId', requirePermission('onu_migration_jobs.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT j.*, src.port_name AS source_port_name, tgt.port_name AS target_port_name, d.name AS onu_name
       FROM onu_migration_jobs j
       LEFT JOIN olt_ports src ON src.id = j.source_olt_port_id
       LEFT JOIN olt_ports tgt ON tgt.id = j.target_olt_port_id
       LEFT JOIN devices d ON d.id = j.onu_device_id
       WHERE j.id = ? AND (j.organization_id = ? OR j.organization_id IS NULL) AND j.deleted_at IS NULL`,
      [req.params.jobId, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * POST /onu-migrations — create an ONU port migration job
 */
router.post('/onu-migrations', requirePermission('onu_migration_jobs.create'), validate(createOnuMigrationJob), async (req, res, next) => {
  try {
    const job = await ftthService.createOnuMigrationJob({
      onuDeviceId: req.body.onu_device_id,
      sourceOltPortId: req.body.source_olt_port_id,
      targetOltPortId: req.body.target_olt_port_id,
      sourceOltDeviceId: req.body.source_olt_device_id,
      targetOltDeviceId: req.body.target_olt_device_id,
      scheduledAt: req.body.scheduled_at,
      notes: req.body.notes,
      orgId: req.orgId,
      createdBy: req.user && req.user.id,
    });
    res.status(201).json({ data: job });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

/**
 * PATCH /onu-migrations/:jobId — cancel or update a migration job
 */
router.patch('/onu-migrations/:jobId', requirePermission('onu_migration_jobs.update'), validate(patchOnuMigrationJob), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id, status FROM onu_migration_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.jobId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    if (check[0].status === 'completed') {
      return res.status(409).json({ error: 'Cannot modify a completed migration job' });
    }
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    await db.query('UPDATE onu_migration_jobs SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.jobId]);
    const [rows] = await db.query('SELECT * FROM onu_migration_jobs WHERE id = ?', [req.params.jobId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /onu-migrations/:jobId — soft-delete migration job
 */
router.delete('/onu-migrations/:jobId', requirePermission('onu_migration_jobs.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_migration_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.jobId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE onu_migration_jobs SET deleted_at = NOW() WHERE id = ?', [req.params.jobId]);
    res.status(204).send();
  } catch (err) { next(err); }
});

/**
 * POST /onu-migrations/:jobId/cancel — cancel a pending migration job
 */
router.post('/onu-migrations/:jobId/cancel', requirePermission('onu_migration_jobs.update'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id, status FROM onu_migration_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.jobId, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'queued'].includes(check[0].status)) {
      return res.status(409).json({ error: 'Only pending or queued jobs can be cancelled' });
    }
    await db.query(
      'UPDATE onu_migration_jobs SET status = \'cancelled\', updated_at = NOW() WHERE id = ?',
      [req.params.jobId],
    );
    const [rows] = await db.query('SELECT * FROM onu_migration_jobs WHERE id = ?', [req.params.jobId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
