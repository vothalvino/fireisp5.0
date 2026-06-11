'use strict';

// =============================================================================
// FireISP 5.0 — OLT Management Routes (§7.1)
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
//   /splitters         — Splitter inventory CRUD (org-scoped)
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

module.exports = router;
