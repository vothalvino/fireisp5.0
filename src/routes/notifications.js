// =============================================================================
// FireISP 5.0 — Staff In-App Notifications
// =============================================================================
// Personal resource: every route is scoped to the authenticated user's own
// rows (user_id = req.user.id), so no requirePermission gate is needed — a
// user can only ever read or mark their own notifications. Rows are written
// by event listeners (work-order assignment, AI reply suggestions, …), never
// by clients, so there is no create endpoint.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../config/database');

const router = Router();

router.use(authenticate);

// GET /notifications — own notifications, newest first (?unread=true, ?limit)
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const unreadOnly = req.query.unread === 'true';
    const [rows] = await db.query(
      `SELECT id, user_id, title, body, type, entity_type, entity_id, is_read, read_at, created_at
       FROM notifications
       WHERE user_id = ? AND deleted_at IS NULL ${unreadOnly ? 'AND is_read = 0' : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit}`,
      [req.user.id],
    );
    const [[{ unread }]] = await db.query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL',
      [req.user.id],
    );
    res.json({ data: rows, meta: { unread } });
  } catch (err) { next(err); }
});

// GET /notifications/unread-count — cheap badge poll
router.get('/unread-count', async (req, res, next) => {
  try {
    const [[{ count }]] = await db.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL',
      [req.user.id],
    );
    res.json({ data: { count } });
  } catch (err) { next(err); }
});

// POST /notifications/read-all — must precede '/:id/read'
router.post('/read-all', async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL',
      [req.user.id],
    );
    res.json({ data: { updated: result.affectedRows } });
  } catch (err) { next(err); }
});

// POST /notifications/:id/read
router.post('/:id/read', async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [req.params.id, req.user.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ data: { id: Number(req.params.id), is_read: 1 } });
  } catch (err) { next(err); }
});

module.exports = router;
