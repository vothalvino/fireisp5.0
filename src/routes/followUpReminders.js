// =============================================================================
// FireISP 5.0 — Follow-up Reminder Routes (§1.3)
// =============================================================================

const { Router } = require('express');
const FollowUpReminder = require('../models/FollowUpReminder');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createFollowUp, updateFollowUp, patchFollowUp } = require('../middleware/schemas/interactions');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(FollowUpReminder, { cacheResource: 'follow-up-reminders' });

router.use(authenticate);
router.use(orgScope);

// List reminders with the client NAME joined in (so the UI never shows a bare
// client_id) plus pagination/status/order — mirrors the /due join.
router.get('/', requirePermission('follow_ups.view'), async (req, res, next) => {
  try {
    const { status, ticket_id, client_id, page = 1, limit = 50, order_by, order, include_deleted } = req.query;
    const conditions = [];
    const params = [];
    if (include_deleted !== 'true') conditions.push('r.deleted_at IS NULL');
    if (req.orgId) { conditions.push('r.organization_id = ?'); params.push(req.orgId); }
    if (status) { conditions.push('r.status = ?'); params.push(status); }
    if (ticket_id) { conditions.push('r.ticket_id = ?'); params.push(ticket_id); }
    if (client_id) { conditions.push('r.client_id = ?'); params.push(client_id); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Whitelist order_by to avoid SQL injection on the column name.
    const ORDER_COLS = { id: 'r.id', due_at: 'r.due_at', created_at: 'r.created_at', status: 'r.status', client_name: 'client_name' };
    const orderCol = ORDER_COLS[order_by] || 'r.due_at';
    const orderDir = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `SELECT r.*, cl.name AS client_name,
              u.first_name AS assignee_first_name, u.last_name AS assignee_last_name
       FROM follow_up_reminders r
       JOIN clients cl ON cl.id = r.client_id
       LEFT JOIN users u ON u.id = r.assigned_to
       ${where}
       ORDER BY ${orderCol} ${orderDir}
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM follow_up_reminders r JOIN clients cl ON cl.id = r.client_id ${where}`,
      params,
    );
    res.json({ data: rows, meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) } });
  } catch (err) { next(err); }
});

// Pending reminders that are due — must precede '/:id'
router.get('/due', requirePermission('follow_ups.view'), async (req, res, next) => {
  try {
    const params = [];
    let sql = `SELECT r.*, cl.name AS client_name,
                      u.first_name AS assignee_first_name, u.last_name AS assignee_last_name
               FROM follow_up_reminders r
               JOIN clients cl ON cl.id = r.client_id
               LEFT JOIN users u ON u.id = r.assigned_to
               WHERE r.status = 'pending' AND r.deleted_at IS NULL AND r.due_at <= NOW()`;
    if (req.orgId) { sql += ' AND r.organization_id = ?'; params.push(req.orgId); }
    if (req.query.assigned_to) { sql += ' AND r.assigned_to = ?'; params.push(req.query.assigned_to); }
    sql += ' ORDER BY r.due_at ASC LIMIT 200';
    const [rows] = await db.query(sql, params);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('follow_ups.view'), ctrl.get);
router.post('/', requirePermission('follow_ups.create'), validate(createFollowUp), (req, res, next) => {
  // Default the assignee to the logged-in staff member.
  if (req.body.assigned_to === undefined && req.user?.id) req.body.assigned_to = req.user.id;
  return ctrl.create(req, res, next);
});
router.put('/:id', requirePermission('follow_ups.update'), validate(updateFollowUp), ctrl.update);
router.patch('/:id', requirePermission('follow_ups.update'), validate(patchFollowUp), ctrl.partialUpdate);
router.delete('/:id', requirePermission('follow_ups.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('follow_ups.update'), ctrl.restore);

// Mark a reminder as completed
router.post('/:id/complete', requirePermission('follow_ups.update'), async (req, res, next) => {
  try {
    const record = await FollowUpReminder.update(req.params.id, {
      status: 'completed',
      completed_at: new Date(),
      completed_by: req.user?.id ?? null,
    }, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

module.exports = router;
