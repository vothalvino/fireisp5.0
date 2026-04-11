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
const { createTicket, updateTicket, createComment } = require('../middleware/schemas/tickets');

const router = Router();
const ctrl = crudController(Ticket);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tickets.view'), ctrl.list);
router.get('/:id', requirePermission('tickets.view'), ctrl.get);
router.post('/', requirePermission('tickets.create'), validate(createTicket), ctrl.create);
router.put('/:id', requirePermission('tickets.update'), validate(updateTicket), ctrl.update);
router.delete('/:id', requirePermission('tickets.delete'), ctrl.destroy);

// Comments
router.get('/:id/comments', requirePermission('tickets.view'), async (req, res, next) => {
  try {
    const comments = await Ticket.getComments(req.params.id);
    res.json({ data: comments });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', requirePermission('tickets.update'), validate(createComment), async (req, res, next) => {
  try {
    const comment = await Ticket.addComment({
      ticket_id: req.params.id,
      user_id: req.user.id,
      body: req.body.body,
      is_internal: req.body.is_internal,
    });
    res.status(201).json({ data: comment });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
