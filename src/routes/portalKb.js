// =============================================================================
// FireISP 5.0 — Portal Knowledge Base Admin Routes (§11.4)
// =============================================================================
// Admin-side CRUD for knowledge-base / FAQ articles surfaced in the portal.
// Mounted at /api/v1/portal-kb (staff-facing, requires JWT + permission).
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const db = require('../config/database');
const { NotFoundError } = require('../utils/errors');

const router = Router();

const kbArticleCreateSchema = {
  category: { type: 'string', required: true, max: 100 },
  title: { type: 'string', required: true, min: 1, max: 300 },
  slug: { type: 'string', required: true, min: 1, max: 320 },
  body: { type: 'string', required: true, min: 1 },
  is_published: { type: 'boolean' },
};

const kbArticleUpdateSchema = {
  category: { type: 'string', max: 100 },
  title: { type: 'string', min: 1, max: 300 },
  slug: { type: 'string', min: 1, max: 320 },
  body: { type: 'string', min: 1 },
  is_published: { type: 'boolean' },
};

router.use(authenticate);

// GET /portal-kb — list articles (admin)
router.get('/', requirePermission('portal_kb.view'), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT id, category, title, slug, is_published, view_count, helpful_yes, helpful_no, created_at, updated_at
       FROM portal_kb_articles
       WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [orgId],
    );
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM portal_kb_articles WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [orgId],
    );
    res.json({ data: rows, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// POST /portal-kb — create article
router.post('/', requirePermission('portal_kb.create'), validate(kbArticleCreateSchema), async (req, res, next) => {
  try {
    const { category, title, slug, body, is_published } = req.body;
    const orgId = req.user.organizationId;

    const [result] = await db.query(
      `INSERT INTO portal_kb_articles (organization_id, category, title, slug, body, is_published, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orgId, category, title, slug, body, is_published !== false ? 1 : 0, req.user.id],
    );
    const [rows] = await db.query(
      'SELECT * FROM portal_kb_articles WHERE id = ?',
      [result.insertId],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /portal-kb/:id — get article
router.get('/:id', requirePermission('portal_kb.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM portal_kb_articles WHERE id = ? AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rows[0]) throw new NotFoundError('KB article');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /portal-kb/:id — update article
router.put('/:id', requirePermission('portal_kb.update'), validate(kbArticleUpdateSchema), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id FROM portal_kb_articles WHERE id = ? AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rows[0]) throw new NotFoundError('KB article');

    const { category, title, slug, body, is_published } = req.body;
    const updates = {};
    if (category !== undefined) updates.category = category;
    if (title !== undefined) updates.title = title;
    if (slug !== undefined) updates.slug = slug;
    if (body !== undefined) updates.body = body;
    if (is_published !== undefined) updates.is_published = is_published ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      const [current] = await db.query('SELECT * FROM portal_kb_articles WHERE id = ?', [req.params.id]);
      return res.json({ data: current[0] });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE portal_kb_articles SET ${setClauses}, updated_at = NOW() WHERE id = ?`,
      [...Object.values(updates), req.params.id],
    );

    const [updated] = await db.query('SELECT * FROM portal_kb_articles WHERE id = ?', [req.params.id]);
    res.json({ data: updated[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /portal-kb/:id — soft delete
router.delete('/:id', requirePermission('portal_kb.delete'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id FROM portal_kb_articles WHERE id = ? AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rows[0]) throw new NotFoundError('KB article');
    await db.query(
      'UPDATE portal_kb_articles SET deleted_at = NOW() WHERE id = ?',
      [req.params.id],
    );
    res.json({ message: 'Article deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
