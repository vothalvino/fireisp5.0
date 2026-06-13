// =============================================================================
// FireISP 5.0 — Custom Reports Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
router.use(authenticate);
router.use(orgScope);

/**
 * Validate that a SQL query is read-only (SELECT only, no dangerous keywords).
 */
function validateReadOnlyQuery(sql) {
  const trimmed = sql.trim();
  if (!/^SELECT\s/i.test(trimmed)) {
    return 'Query must start with SELECT';
  }
  if (/;/.test(trimmed)) {
    return 'Query must not contain semicolons';
  }
  const dangerous = /\b(INTO|UPDATE|INSERT|DELETE|DROP|ALTER|TRUNCATE|CREATE|EXEC|EXECUTE|GRANT|REVOKE)\b/i;
  if (dangerous.test(trimmed)) {
    return 'Query contains disallowed keywords';
  }
  return null;
}

/**
 * Add LIMIT 1000 if no LIMIT clause present.
 */
function enforceLimit(sql) {
  if (!/\bLIMIT\b/i.test(sql)) {
    return `${sql.trim()} LIMIT 1000`;
  }
  return sql;
}

// GET /api/custom-reports
router.get('/', requirePermission('custom_reports.view'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      `SELECT * FROM custom_reports
       WHERE organization_id = ? AND deleted_at IS NULL AND (is_public = 1 OR created_by = ?)
       ORDER BY created_at DESC`,
      [req.orgId, req.user.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/custom-reports/:id
router.get('/:id', requirePermission('custom_reports.view'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      `SELECT * FROM custom_reports
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND (is_public = 1 OR created_by = ?)`,
      [req.params.id, req.orgId, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/custom-reports
router.post('/', requirePermission('custom_reports.create'), async (req, res, next) => {
  try {
    const { name, description, query_type = 'sql', sql_query, visual_config, is_public = 0 } = req.body;

    if (!name) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });

    if (query_type === 'sql' && sql_query) {
      const err = validateReadOnlyQuery(sql_query);
      if (err) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: err } });
    }

    const [result] = await db.query(
      `INSERT INTO custom_reports
         (organization_id, name, description, query_type, sql_query, visual_config, is_public, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, description || null, query_type, sql_query || null,
        visual_config ? JSON.stringify(visual_config) : null, is_public ? 1 : 0, req.user.id],
    );

    const [rows] = await db.queryReplica(
      'SELECT * FROM custom_reports WHERE id = ?',
      [result.insertId],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/custom-reports/:id
router.put('/:id', requirePermission('custom_reports.manage'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      'SELECT * FROM custom_reports WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });

    const { name, description, sql_query, visual_config, is_public } = req.body;

    if (sql_query) {
      const err = validateReadOnlyQuery(sql_query);
      if (err) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: err } });
    }

    await db.query(
      `UPDATE custom_reports
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           sql_query = COALESCE(?, sql_query),
           visual_config = COALESCE(?, visual_config),
           is_public = COALESCE(?, is_public),
           updated_at = NOW()
       WHERE id = ?`,
      [name, description, sql_query,
        visual_config !== undefined ? JSON.stringify(visual_config) : null,
        is_public !== undefined ? (is_public ? 1 : 0) : null,
        req.params.id],
    );

    const [rows] = await db.queryReplica('SELECT * FROM custom_reports WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/custom-reports/:id
router.delete('/:id', requirePermission('custom_reports.manage'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      'SELECT id FROM custom_reports WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });

    await db.query('UPDATE custom_reports SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/custom-reports/:id/execute — execute the SQL query
router.post('/:id/execute', requirePermission('custom_reports.execute'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      `SELECT * FROM custom_reports
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND (is_public = 1 OR created_by = ?)`,
      [req.params.id, req.orgId, req.user.id],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });

    const report = existing[0];
    if (report.query_type !== 'sql' || !report.sql_query) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Only SQL reports can be executed via this endpoint' } });
    }

    const validErr = validateReadOnlyQuery(report.sql_query);
    if (validErr) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: validErr } });

    const safeQuery = enforceLimit(report.sql_query);

    // Execute with 30-second timeout via SET SESSION
    await db.queryReplica('SET SESSION max_execution_time = 30000', []).catch(() => {});
    const [rows] = await db.queryReplica(safeQuery, []);

    // Update last_run_at
    await db.query('UPDATE custom_reports SET last_run_at = NOW() WHERE id = ?', [report.id]);

    res.json({
      data: rows,
      meta: {
        report_id: report.id,
        name: report.name,
        row_count: rows.length,
        executed_at: new Date().toISOString(),
        limited: !/\bLIMIT\b/i.test(report.sql_query),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
