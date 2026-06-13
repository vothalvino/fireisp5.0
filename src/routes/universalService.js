// =============================================================================
// FireISP 5.0 — Universal Service Routes (§16.6)
// Covers: uso_obligations, rural_coverage_reports
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// =============================================================================
// USO Obligations — /uso-obligations
// =============================================================================

router.get('/uso-obligations', requirePermission('uso_obligations.view'), async (req, res, next) => {
  try {
    const { status, obligation_type, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (obligation_type) { conditions.push('obligation_type = ?'); params.push(obligation_type); }

    const where = conditions.join(' AND ');
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      `SELECT * FROM uso_obligations WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset],
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM uso_obligations WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/uso-obligations', requirePermission('uso_obligations.manage'), async (req, res, next) => {
  try {
    const { obligation_type, description, target_metric, target_value, period_start, period_end, authority_ref, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO uso_obligations (organization_id, obligation_type, description, target_metric, target_value, period_start, period_end, authority_ref, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, obligation_type, description || null, target_metric || null, target_value || null, period_start || null, period_end || null, authority_ref || null, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/uso-obligations/:id', requirePermission('uso_obligations.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM uso_obligations WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/uso-obligations/:id', requirePermission('uso_obligations.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { obligation_type, description, target_metric, target_value, period_start, period_end, authority_ref, status, notes } = req.body;

    await db.query(
      `UPDATE uso_obligations SET obligation_type = ?, description = ?, target_metric = ?, target_value = ?, period_start = ?, period_end = ?, authority_ref = ?, status = ?, notes = ?, updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [obligation_type, description || null, target_metric || null, target_value || null, period_start || null, period_end || null, authority_ref || null, status || 'pending', notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/uso-obligations/:id/report', requirePermission('uso_obligations.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { actual_value } = req.body;

    await db.query(
      'UPDATE uso_obligations SET status = \'reported\', actual_value = ?, reported_at = NOW(), updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [actual_value || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Rural Coverage — /rural-coverage
// NOTE: /summary must be BEFORE /:id to prevent routing conflict
// =============================================================================

router.get('/rural-coverage/summary', requirePermission('rural_coverage.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT SUM(homes_passed) AS total_homes_passed, SUM(homes_connected) AS total_homes_connected,
              COUNT(DISTINCT locality_name) AS locality_count, SUM(is_underserved) AS underserved_count
       FROM rural_coverage_reports WHERE organization_id = ?`,
      [req.orgId],
    );

    res.json({ data: rows[0] || {} });
  } catch (err) {
    next(err);
  }
});

router.get('/rural-coverage', requirePermission('rural_coverage.view'), async (req, res, next) => {
  try {
    const { report_period, state, is_underserved, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (report_period) { conditions.push('report_period = ?'); params.push(report_period); }
    if (state) { conditions.push('state = ?'); params.push(state); }
    if (is_underserved !== undefined) { conditions.push('is_underserved = ?'); params.push(is_underserved); }

    const where = conditions.join(' AND ');
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      `SELECT * FROM rural_coverage_reports WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset],
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM rural_coverage_reports WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/rural-coverage', requirePermission('rural_coverage.manage'), async (req, res, next) => {
  try {
    const {
      report_period, locality_name, inegi_code, state, municipality,
      homes_passed, homes_connected, service_type, download_speed_mbps,
      upload_speed_mbps, is_underserved, notes,
    } = req.body;

    const [result] = await db.query(
      `INSERT INTO rural_coverage_reports (organization_id, report_period, locality_name, inegi_code, state, municipality, homes_passed, homes_connected, service_type, download_speed_mbps, upload_speed_mbps, is_underserved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, report_period, locality_name, inegi_code || null, state || null, municipality || null, homes_passed || 0, homes_connected || 0, service_type || null, download_speed_mbps || null, upload_speed_mbps || null, is_underserved ? 1 : 0, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/rural-coverage/:id', requirePermission('rural_coverage.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM rural_coverage_reports WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/rural-coverage/:id', requirePermission('rural_coverage.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      report_period, locality_name, inegi_code, state, municipality,
      homes_passed, homes_connected, service_type, download_speed_mbps,
      upload_speed_mbps, is_underserved, notes,
    } = req.body;

    await db.query(
      `UPDATE rural_coverage_reports SET report_period = ?, locality_name = ?, inegi_code = ?, state = ?, municipality = ?, homes_passed = ?, homes_connected = ?, service_type = ?, download_speed_mbps = ?, upload_speed_mbps = ?, is_underserved = ?, notes = ?, updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [report_period, locality_name, inegi_code || null, state || null, municipality || null, homes_passed || 0, homes_connected || 0, service_type || null, download_speed_mbps || null, upload_speed_mbps || null, is_underserved ? 1 : 0, notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
