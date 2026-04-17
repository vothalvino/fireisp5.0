// =============================================================================
// FireISP 5.0 — Ticket Routes
// =============================================================================

const { Router } = require('express');
const Ticket = require('../models/Ticket');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createTicket, updateTicket, patchTicket, createComment } = require('../middleware/schemas/tickets');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Ticket);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tickets.view'), ctrl.list);
router.get('/:id', requirePermission('tickets.view'), ctrl.get);
router.post('/', requirePermission('tickets.create'), validate(createTicket), ctrl.create);
router.put('/:id', requirePermission('tickets.update'), validate(updateTicket), ctrl.update);
router.patch('/:id', requirePermission('tickets.update'), validate(patchTicket), ctrl.partialUpdate);
router.delete('/:id', requirePermission('tickets.delete'), ctrl.destroy);

// Ticket comments
router.get('/:id/comments', requirePermission('tickets.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT tc.*, u.first_name, u.last_name FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.user_id WHERE tc.ticket_id = ? ORDER BY tc.created_at ASC',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/comments', requirePermission('tickets.update'), validate(createComment), async (req, res, next) => {
  try {
    const { body, is_internal } = req.body;
    const [result] = await db.query(
      'INSERT INTO ticket_comments (ticket_id, user_id, body, is_internal) VALUES (?, ?, ?, ?)',
      [req.params.id, req.user.id, body, is_internal || false],
    );
    const [rows] = await db.query('SELECT * FROM ticket_comments WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
