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
const { pubsub } = require('../services/pubsub');
const jobQueue = require('../services/jobQueueService');
const logger = require('../utils/logger').child({ service: 'routes/tickets' });

const router = Router();
const ctrl = crudController(Ticket);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tickets.view'), ctrl.list);
router.get('/:id', requirePermission('tickets.view'), ctrl.get);
router.post('/', requirePermission('tickets.create'), validate(createTicket), async (req, res, next) => {
  try {
    if (Ticket.hasOrgScope && req.orgId) {
      req.body.organization_id = req.orgId;
    }
    const record = await Ticket.create(req.body);

    // Enqueue AI triage for the initial description (fires async, non-blocking)
    if (record.description) {
      jobQueue.add('ai-triage', {
        orgId:       req.orgId,
        ticketId:    record.id,
        channel:     req.body.channel || 'portal',
        inboundText: record.description,
        contractId:  record.contract_id || null,
      }).catch(err => logger.warn({ err: err.message, ticketId: record.id }, 'aiTriage enqueue failed on ticket create'));
    }

    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});
router.put('/:id', requirePermission('tickets.update'), validate(updateTicket), ctrl.update);
router.patch('/:id', requirePermission('tickets.update'), validate(patchTicket), ctrl.partialUpdate);
router.delete('/:id', requirePermission('tickets.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('tickets.update'), ctrl.restore);

// Ticket comments
router.get('/:id/comments', requirePermission('tickets.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT tc.*, u.first_name, u.last_name FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.user_id WHERE tc.ticket_id = ? AND tc.deleted_at IS NULL ORDER BY tc.created_at ASC',
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
    pubsub.publish('TICKET_COMMENT_ADDED', { ticketCommentAdded: rows[0], ticketId: String(req.params.id) });

    // Enqueue AI triage when a client posts a new non-internal comment
    if (!is_internal) {
      const [[ticket]] = await db.query(
        'SELECT id, organization_id, contract_id FROM tickets WHERE id = ? AND deleted_at IS NULL',
        [req.params.id],
      );
      if (ticket) {
        jobQueue.add('ai-triage', {
          orgId:       ticket.organization_id,
          ticketId:    ticket.id,
          channel:     'portal',
          inboundText: body,
          contractId:  ticket.contract_id || null,
        }).catch(err => logger.warn({ err: err.message, ticketId: ticket.id }, 'aiTriage enqueue failed on comment'));
      }
    }

    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
