// =============================================================================
// FireISP 5.0 — Dashboard Widgets Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /api/dashboard-widgets — list widgets for the authenticated user
router.get('/', requirePermission('dashboard_widgets.view'), async (req, res, next) => {
  try {
    const [rows] = await db.queryReplica(
      `SELECT * FROM dashboard_widgets
       WHERE user_id = ? AND organization_id = ?
       ORDER BY position_y ASC, position_x ASC`,
      [req.user.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /api/dashboard-widgets
router.post('/', requirePermission('dashboard_widgets.manage'), async (req, res, next) => {
  try {
    const {
      widget_type = 'revenue_chart',
      title,
      position_x = 0,
      position_y = 0,
      width = 2,
      height = 2,
      config = null,
      is_visible = 1,
    } = req.body;

    if (!title) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
    }

    const [result] = await db.query(
      `INSERT INTO dashboard_widgets
         (user_id, organization_id, widget_type, title, position_x, position_y, width, height, config, is_visible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, req.orgId, widget_type, title, position_x, position_y, width, height,
        config ? JSON.stringify(config) : null, is_visible ? 1 : 0],
    );

    const [rows] = await db.queryReplica(
      'SELECT * FROM dashboard_widgets WHERE id = ?',
      [result.insertId],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/dashboard-widgets/batch — bulk position update (MUST be before /:id)
router.put('/batch', requirePermission('dashboard_widgets.manage'), async (req, res, next) => {
  try {
    const { widgets } = req.body;
    if (!Array.isArray(widgets)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'widgets array required' } });
    }

    for (const w of widgets) {
      if (!w.id) continue;
      await db.query(
        `UPDATE dashboard_widgets
         SET position_x = COALESCE(?, position_x), position_y = COALESCE(?, position_y),
             width = COALESCE(?, width), height = COALESCE(?, height)
         WHERE id = ? AND user_id = ? AND organization_id = ?`,
        [w.position_x, w.position_y, w.width, w.height, w.id, req.user.id, req.orgId],
      );
    }

    const [rows] = await db.queryReplica(
      'SELECT * FROM dashboard_widgets WHERE user_id = ? AND organization_id = ? ORDER BY position_y, position_x',
      [req.user.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// PUT /api/dashboard-widgets/:id
router.put('/:id', requirePermission('dashboard_widgets.manage'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      'SELECT id FROM dashboard_widgets WHERE id = ? AND user_id = ? AND organization_id = ?',
      [req.params.id, req.user.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Widget not found' } });

    const { title, position_x, position_y, width, height, config, is_visible } = req.body;

    await db.query(
      `UPDATE dashboard_widgets
       SET title = COALESCE(?, title),
           position_x = COALESCE(?, position_x),
           position_y = COALESCE(?, position_y),
           width = COALESCE(?, width),
           height = COALESCE(?, height),
           config = COALESCE(?, config),
           is_visible = COALESCE(?, is_visible),
           updated_at = NOW()
       WHERE id = ?`,
      [title, position_x, position_y, width, height,
        config !== undefined ? JSON.stringify(config) : null,
        is_visible !== undefined ? (is_visible ? 1 : 0) : null,
        req.params.id],
    );

    const [rows] = await db.queryReplica(
      'SELECT * FROM dashboard_widgets WHERE id = ?',
      [req.params.id],
    );
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/dashboard-widgets/:id
router.delete('/:id', requirePermission('dashboard_widgets.manage'), async (req, res, next) => {
  try {
    const [existing] = await db.queryReplica(
      'SELECT id FROM dashboard_widgets WHERE id = ? AND user_id = ? AND organization_id = ?',
      [req.params.id, req.user.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Widget not found' } });

    await db.query('DELETE FROM dashboard_widgets WHERE id = ?', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
