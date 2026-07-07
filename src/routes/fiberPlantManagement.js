'use strict';

// =============================================================================
// FireISP 5.0 — Fiber Plant Management Routes (§7.4)
// =============================================================================
// Mounted at /api/fiber-plant and /api/v1/fiber-plant.
//
// Resources:
//   /fiber-routes           — fiber route topology CRUD
//   /fiber-routes/:id       — single route + sub-resources
//   /fiber-routes/:id/path  — full CO→ONU path for a route
//   /odf/frames             — ODF frame inventory CRUD
//   /odf/frames/:id         — single frame + ports
//   /odf/ports              — ODF port CRUD
//   /odf/ports/:id          — single ODF port
//   /odf/cross-connects     — patch-cord cross-connect CRUD
//   /otdr/tests             — OTDR test result CRUD
//   /otdr/tests/:id         — single test result
//   /sfp                    — SFP inventory CRUD
//   /sfp/:id/diagnostics    — latest SNMP DDM diagnostics for installed SFP
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { buildInsert, buildUpdate } = require('../utils/sqlBuild');
const {
  createFiberRoute, updateFiberRoute, patchFiberRoute,
} = require('../middleware/schemas/fiberRoutes');
const {
  createOdfFrame, updateOdfFrame, patchOdfFrame,
  createOdfPort, patchOdfPort,
  createOdfCrossConnect, patchOdfCrossConnect,
} = require('../middleware/schemas/odfFrames');
const {
  createOtdrTest, patchOtdrTest,
} = require('../middleware/schemas/otdrTests');
const {
  createSfpInventory, updateSfpInventory, patchSfpInventory,
} = require('../middleware/schemas/sfpInventory');
const fiberPlantService = require('../services/fiberPlantService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ===========================================================================
// Fiber Routes
// ===========================================================================

/**
 * GET /fiber-routes — list fiber routes for org
 */
router.get('/fiber-routes', requirePermission('fiber_routes.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, route_type, status, from_olt_port_id } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = `SELECT fr.*,
        fd.name AS from_device_name,
        td.name AS to_device_name,
        sp.name AS from_splitter_name,
        tsp.name AS to_splitter_name
      FROM fiber_routes fr
      LEFT JOIN devices fd   ON fd.id   = fr.from_device_id
      LEFT JOIN devices td   ON td.id   = fr.to_device_id
      LEFT JOIN olt_splitters sp  ON sp.id  = fr.from_splitter_id
      LEFT JOIN olt_splitters tsp ON tsp.id = fr.to_splitter_id
      WHERE (fr.organization_id = ? OR fr.organization_id IS NULL) AND fr.deleted_at IS NULL`;
    const params = [req.orgId];

    if (route_type) { sql += ' AND fr.route_type = ?'; params.push(route_type); }
    if (status) { sql += ' AND fr.status = ?'; params.push(status); }
    if (from_olt_port_id) { sql += ' AND fr.from_olt_port_id = ?'; params.push(from_olt_port_id); }

    const countSql = sql.replace(/SELECT fr\.\*[\s\S]*?FROM/, 'SELECT COUNT(*) AS total FROM');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY fr.route_type ASC, fr.created_at ASC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /fiber-routes/:id — single fiber route
 */
router.get('/fiber-routes/:id', requirePermission('fiber_routes.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT fr.*, fd.name AS from_device_name, td.name AS to_device_name
       FROM fiber_routes fr
       LEFT JOIN devices fd ON fd.id = fr.from_device_id
       LEFT JOIN devices td ON td.id = fr.to_device_id
       WHERE fr.id = ? AND (fr.organization_id = ? OR fr.organization_id IS NULL) AND fr.deleted_at IS NULL`,
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * GET /fiber-routes/port/:portId/path — full fiber path for a PON port
 */
router.get('/fiber-routes/port/:portId/path', requirePermission('fiber_routes.view'), async (req, res, next) => {
  try {
    const path = await fiberPlantService.getFiberPathForPort(req.params.portId, req.orgId);
    res.json({ data: path });
  } catch (err) { next(err); }
});

/**
 * GET /fiber-routes/onu/:onuDetailId/path — fiber path leading to an ONU
 */
router.get('/fiber-routes/onu/:onuDetailId/path', requirePermission('fiber_routes.view'), async (req, res, next) => {
  try {
    const path = await fiberPlantService.getFiberPathForOnu(req.params.onuDetailId, req.orgId);
    res.json({ data: path });
  } catch (err) { next(err); }
});

/**
 * POST /fiber-routes — create a fiber route segment
 */
router.post('/fiber-routes', requirePermission('fiber_routes.create'), validate(createFiberRoute), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const { columns, placeholders, values } = buildInsert({ organization_id: req.orgId, ...fields });
    const [result] = await db.query(
      `INSERT INTO fiber_routes (${columns}) VALUES (${placeholders})`,
      values,
    );
    const [rows] = await db.query(
      'SELECT * FROM fiber_routes WHERE id = ?',
      [result.insertId],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PUT /fiber-routes/:id — full update
 */
router.put('/fiber-routes/:id', requirePermission('fiber_routes.update'), validate(updateFiberRoute), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM fiber_routes WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    const { assignments, values } = buildUpdate(updateData);
    const setClause = assignments ? `${assignments}, updated_at = NOW()` : 'updated_at = NOW()';
    await db.query(`UPDATE fiber_routes SET ${setClause} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM fiber_routes WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PATCH /fiber-routes/:id — partial update
 */
router.patch('/fiber-routes/:id', requirePermission('fiber_routes.update'), validate(patchFiberRoute), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM fiber_routes WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    const { assignments, values } = buildUpdate(updateData);
    await db.query(`UPDATE fiber_routes SET ${assignments}, updated_at = NOW() WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM fiber_routes WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /fiber-routes/:id — soft-delete
 */
router.delete('/fiber-routes/:id', requirePermission('fiber_routes.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM fiber_routes WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE fiber_routes SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// ODF Frames
// ===========================================================================

/**
 * GET /odf/frames — list ODF frames for org
 */
router.get('/odf/frames', requirePermission('odf_frames.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status, site_id } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT f.*, s.name AS site_name FROM odf_frames f LEFT JOIN sites s ON s.id = f.site_id WHERE (f.organization_id = ? OR f.organization_id IS NULL) AND f.deleted_at IS NULL';
    const params = [req.orgId];
    if (status) { sql += ' AND f.status = ?'; params.push(status); }
    if (site_id) { sql += ' AND f.site_id = ?'; params.push(site_id); }

    const countSql = sql.replace('SELECT f.*, s.name AS site_name', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY f.name ASC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /odf/frames/:id — single ODF frame with ports
 */
router.get('/odf/frames/:id', requirePermission('odf_frames.view'), async (req, res, next) => {
  try {
    const data = await fiberPlantService.getOdfFrameWithPorts(req.params.id, req.orgId);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * POST /odf/frames — create ODF frame
 */
router.post('/odf/frames', requirePermission('odf_frames.create'), validate(createOdfFrame), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const { columns, placeholders, values } = buildInsert({ organization_id: req.orgId, ...fields });
    const [result] = await db.query(`INSERT INTO odf_frames (${columns}) VALUES (${placeholders})`, values);
    const [rows] = await db.query('SELECT * FROM odf_frames WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PUT /odf/frames/:id — full update
 */
router.put('/odf/frames/:id', requirePermission('odf_frames.update'), validate(updateOdfFrame), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM odf_frames WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    const { assignments, values } = buildUpdate(updateData);
    const setClause = assignments ? `${assignments}, updated_at = NOW()` : 'updated_at = NOW()';
    await db.query(`UPDATE odf_frames SET ${setClause} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM odf_frames WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PATCH /odf/frames/:id — partial update
 */
router.patch('/odf/frames/:id', requirePermission('odf_frames.update'), validate(patchOdfFrame), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM odf_frames WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    const { assignments, values } = buildUpdate(updateData);
    await db.query(`UPDATE odf_frames SET ${assignments}, updated_at = NOW() WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM odf_frames WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /odf/frames/:id — soft-delete
 */
router.delete('/odf/frames/:id', requirePermission('odf_frames.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM odf_frames WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE odf_frames SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// ODF Ports
// ===========================================================================

/**
 * GET /odf/ports — list ODF ports for org (with optional frame filter)
 */
router.get('/odf/ports', requirePermission('odf_ports.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, odf_frame_id, port_status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT p.*, f.name AS frame_name FROM odf_ports p JOIN odf_frames f ON f.id = p.odf_frame_id WHERE (p.organization_id = ? OR p.organization_id IS NULL) AND p.deleted_at IS NULL';
    const params = [req.orgId];
    if (odf_frame_id) { sql += ' AND p.odf_frame_id = ?'; params.push(odf_frame_id); }
    if (port_status) { sql += ' AND p.port_status = ?'; params.push(port_status); }

    const countSql = sql.replace('SELECT p.*, f.name AS frame_name', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY p.odf_frame_id ASC, p.port_number ASC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /odf/ports/:id — single ODF port
 */
router.get('/odf/ports/:id', requirePermission('odf_ports.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT p.*, f.name AS frame_name FROM odf_ports p JOIN odf_frames f ON f.id = p.odf_frame_id WHERE p.id = ? AND (p.organization_id = ? OR p.organization_id IS NULL) AND p.deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * POST /odf/ports — create ODF port
 */
router.post('/odf/ports', requirePermission('odf_ports.create'), validate(createOdfPort), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const { columns, placeholders, values } = buildInsert({ organization_id: req.orgId, ...fields });
    const [result] = await db.query(`INSERT INTO odf_ports (${columns}) VALUES (${placeholders})`, values);
    const [rows] = await db.query('SELECT * FROM odf_ports WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PATCH /odf/ports/:id — update ODF port status/label
 */
router.patch('/odf/ports/:id', requirePermission('odf_ports.update'), validate(patchOdfPort), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM odf_ports WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, odf_frame_id: _____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    const { assignments, values } = buildUpdate(updateData);
    await db.query(`UPDATE odf_ports SET ${assignments}, updated_at = NOW() WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM odf_ports WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /odf/ports/:id — soft-delete
 */
router.delete('/odf/ports/:id', requirePermission('odf_ports.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM odf_ports WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE odf_ports SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// ODF Cross-Connects
// ===========================================================================

/**
 * GET /odf/cross-connects — list cross-connects for org
 */
router.get('/odf/cross-connects', requirePermission('odf_cross_connects.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM odf_cross_connects WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL';
    const params = [req.orgId];
    if (status) { sql += ' AND status = ?'; params.push(status); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /odf/cross-connects/:id — single cross-connect
 */
router.get('/odf/cross-connects/:id', requirePermission('odf_cross_connects.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM odf_cross_connects WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * POST /odf/cross-connects — create cross-connect
 */
router.post('/odf/cross-connects', requirePermission('odf_cross_connects.create'), validate(createOdfCrossConnect), async (req, res, next) => {
  try {
    if (req.body.port_a_id === req.body.port_b_id) {
      return res.status(400).json({ error: 'port_a_id and port_b_id must differ' });
    }
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const { columns, placeholders, values } = buildInsert({ organization_id: req.orgId, ...fields });
    const [result] = await db.query(`INSERT INTO odf_cross_connects (${columns}) VALUES (${placeholders})`, values);
    const [rows] = await db.query('SELECT * FROM odf_cross_connects WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PATCH /odf/cross-connects/:id — partial update
 */
router.patch('/odf/cross-connects/:id', requirePermission('odf_cross_connects.update'), validate(patchOdfCrossConnect), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM odf_cross_connects WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    const { assignments, values } = buildUpdate(updateData);
    await db.query(`UPDATE odf_cross_connects SET ${assignments}, updated_at = NOW() WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM odf_cross_connects WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /odf/cross-connects/:id — soft-delete
 */
router.delete('/odf/cross-connects/:id', requirePermission('odf_cross_connects.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM odf_cross_connects WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE odf_cross_connects SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// OTDR Test Results
// ===========================================================================

/**
 * GET /otdr/tests — list OTDR test results for org
 */
router.get('/otdr/tests', requirePermission('otdr_tests.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, fiber_route_id, olt_port_id, fault_detected } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT t.*, fr.name AS fiber_route_name FROM otdr_test_results t LEFT JOIN fiber_routes fr ON fr.id = t.fiber_route_id WHERE (t.organization_id = ? OR t.organization_id IS NULL) AND t.deleted_at IS NULL';
    const params = [req.orgId];
    if (fiber_route_id) { sql += ' AND t.fiber_route_id = ?'; params.push(fiber_route_id); }
    if (olt_port_id) { sql += ' AND t.olt_port_id = ?'; params.push(olt_port_id); }
    if (fault_detected !== null && fault_detected !== undefined) { sql += ' AND t.fault_detected = ?'; params.push(fault_detected === '1' ? 1 : 0); }

    const countSql = sql.replace('SELECT t.*, fr.name AS fiber_route_name', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY t.tested_at DESC, t.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /otdr/tests/:id — single OTDR test result
 */
router.get('/otdr/tests/:id', requirePermission('otdr_tests.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM otdr_test_results WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * POST /otdr/tests — create/import OTDR test result
 */
router.post('/otdr/tests', requirePermission('otdr_tests.create'), validate(createOtdrTest), async (req, res, next) => {
  try {
    const result = await fiberPlantService.createOtdrTestResult({
      orgId: req.orgId,
      fiberRouteId: req.body.fiber_route_id,
      oltPortId: req.body.olt_port_id,
      oltDeviceId: req.body.olt_device_id,
      testType: req.body.test_type,
      wavelengthNm: req.body.wavelength_nm,
      pulseWidthNs: req.body.pulse_width_ns,
      rangeM: req.body.range_m,
      totalLossDb: req.body.total_loss_db,
      totalLengthM: req.body.total_length_m,
      faultDetected: req.body.fault_detected,
      faultDistanceM: req.body.fault_distance_m,
      faultType: req.body.fault_type,
      events: req.body.events,
      sorFilePath: req.body.sor_file_path,
      jobStatus: req.body.job_status,
      testedAt: req.body.tested_at,
      testedBy: req.user && req.user.id,
      notes: req.body.notes,
    });
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

/**
 * PATCH /otdr/tests/:id — update test record (job status, notes, fault info)
 */
router.patch('/otdr/tests/:id', requirePermission('otdr_tests.update'), validate(patchOtdrTest), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM otdr_test_results WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    const { assignments, values } = buildUpdate(updateData);
    await db.query(`UPDATE otdr_test_results SET ${assignments}, updated_at = NOW() WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM otdr_test_results WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /otdr/tests/:id — soft-delete
 */
router.delete('/otdr/tests/:id', requirePermission('otdr_tests.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM otdr_test_results WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE otdr_test_results SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// SFP Inventory
// ===========================================================================

/**
 * GET /sfp — list SFP inventory for org
 */
router.get('/sfp', requirePermission('sfp_inventory.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, lifecycle_status, form_factor, installed_device_id } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT si.*, d.name AS device_name, ii.name AS item_name FROM sfp_inventory si LEFT JOIN devices d ON d.id = si.installed_device_id LEFT JOIN inventory_items ii ON ii.id = si.inventory_item_id WHERE (si.organization_id = ? OR si.organization_id IS NULL) AND si.deleted_at IS NULL';
    const params = [req.orgId];
    if (lifecycle_status) { sql += ' AND si.lifecycle_status = ?'; params.push(lifecycle_status); }
    if (form_factor) { sql += ' AND si.form_factor = ?'; params.push(form_factor); }
    if (installed_device_id) { sql += ' AND si.installed_device_id = ?'; params.push(installed_device_id); }

    const countSql = sql.replace('SELECT si.*, d.name AS device_name, ii.name AS item_name', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY si.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

/**
 * GET /sfp/:id — single SFP record
 */
router.get('/sfp/:id', requirePermission('sfp_inventory.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT si.*, d.name AS device_name FROM sfp_inventory si LEFT JOIN devices d ON d.id = si.installed_device_id WHERE si.id = ? AND (si.organization_id = ? OR si.organization_id IS NULL) AND si.deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * GET /sfp/:id/diagnostics — SFP SNMP DDM diagnostics for installed device
 */
router.get('/sfp/:id/diagnostics', requirePermission('sfp_inventory.view'), async (req, res, next) => {
  try {
    const [sfpRows] = await db.query(
      'SELECT id, installed_device_id FROM sfp_inventory WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!sfpRows.length) return res.status(404).json({ error: 'Not found' });
    if (!sfpRows[0].installed_device_id) {
      return res.json({ data: { inventory: sfpRows[0], diagnostics: null } });
    }
    const data = await fiberPlantService.getSfpDiagnosticsForDevice(sfpRows[0].installed_device_id, req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * POST /sfp — add SFP module record
 */
router.post('/sfp', requirePermission('sfp_inventory.create'), validate(createSfpInventory), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const { columns, placeholders, values } = buildInsert({ organization_id: req.orgId, ...fields });
    const [result] = await db.query(`INSERT INTO sfp_inventory (${columns}) VALUES (${placeholders})`, values);
    const [rows] = await db.query('SELECT * FROM sfp_inventory WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PUT /sfp/:id — full update SFP record
 */
router.put('/sfp/:id', requirePermission('sfp_inventory.update'), validate(updateSfpInventory), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM sfp_inventory WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    const { assignments, values } = buildUpdate(updateData);
    const setClause = assignments ? `${assignments}, updated_at = NOW()` : 'updated_at = NOW()';
    await db.query(`UPDATE sfp_inventory SET ${setClause} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM sfp_inventory WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * PATCH /sfp/:id — partial update (lifecycle, port, device)
 */
router.patch('/sfp/:id', requirePermission('sfp_inventory.update'), validate(patchSfpInventory), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM sfp_inventory WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    const { assignments, values } = buildUpdate(updateData);
    await db.query(`UPDATE sfp_inventory SET ${assignments}, updated_at = NOW() WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await db.query('SELECT * FROM sfp_inventory WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * DELETE /sfp/:id — soft-delete
 */
router.delete('/sfp/:id', requirePermission('sfp_inventory.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM sfp_inventory WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE sfp_inventory SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
