// =============================================================================
// FireISP 5.0 — Report Definitions Routes
// =============================================================================
// CRUD for the report_definitions registry.
// Built-in definitions (organization_id IS NULL, is_system = 1) are visible to
// all orgs; user-created definitions are scoped to their org.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// GET /api/report-definitions — list built-in + org-scoped definitions
// ---------------------------------------------------------------------------
router.get('/', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      `SELECT * FROM report_definitions
       WHERE deleted_at IS NULL
         AND (organization_id IS NULL OR organization_id = ?)
       ORDER BY is_system DESC, category, name`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/report-definitions/:id
// ---------------------------------------------------------------------------
router.get('/:id', requirePermission('reports.view'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      `SELECT * FROM report_definitions
       WHERE id = ? AND deleted_at IS NULL
         AND (organization_id IS NULL OR organization_id = ?)`,
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report definition not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/report-definitions — create a user-defined definition
// ---------------------------------------------------------------------------
router.post('/', requirePermission('reports.manage_definitions'), async (req, res, next) => {
  try {
    const { name, category = 'custom', description, sql_template, parameters } = req.body;

    if (!name) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    }

    const validCategories = ['financial', 'operational', 'network', 'compliance', 'custom'];
    if (!validCategories.includes(category)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: `category must be one of: ${validCategories.join(', ')}` } });
    }

    const [result] = await db.query(
      `INSERT INTO report_definitions
         (organization_id, name, category, description, sql_template, parameters, is_system, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [req.orgId, name, category, description || null, sql_template || null,
        parameters ? JSON.stringify(parameters) : null, req.user.id],
    );

    const [rows] = await db.queryReplica(
      'SELECT * FROM report_definitions WHERE id = ?',
      [result.insertId],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /api/report-definitions/:id — update a user-created definition (not system)
// ---------------------------------------------------------------------------
router.put('/:id', requirePermission('reports.manage_definitions'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      `SELECT * FROM report_definitions
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND is_system = 0`,
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report definition not found or is a system definition' } });

    const { name, category, description, sql_template, parameters } = req.body;

    await db.query(
      `UPDATE report_definitions
       SET name        = COALESCE(?, name),
           category    = COALESCE(?, category),
           description = COALESCE(?, description),
           sql_template = COALESCE(?, sql_template),
           parameters  = COALESCE(?, parameters),
           updated_at  = NOW()
       WHERE id = ?`,
      [name, category,
        description !== undefined ? description : null,
        sql_template !== undefined ? sql_template : null,
        parameters !== undefined ? JSON.stringify(parameters) : null,
        req.params.id],
    );

    const [rows] = await db.queryReplica(
      'SELECT * FROM report_definitions WHERE id = ?',
      [req.params.id],
    );
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /api/report-definitions/:id — soft-delete a user-created definition
// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('reports.manage_definitions'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      `SELECT id FROM report_definitions
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND is_system = 0`,
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report definition not found or is a system definition' } });

    await db.query('UPDATE report_definitions SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
