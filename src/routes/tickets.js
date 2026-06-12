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
const { createTicket, updateTicket, patchTicket, createComment, updateComment } = require('../middleware/schemas/tickets');
const db = require('../config/database');
const { pubsub } = require('../services/pubsub');
const jobQueue = require('../services/jobQueueService');
const logger = require('../utils/logger').child({ service: 'routes/tickets' });
const aiReplyService = require('../services/aiReplyService');

const router = Router();
const ctrl = crudController(Ticket);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tickets.view'), ctrl.list);

// GET /tickets/stats — ticket counts by status (must be before /:id)
router.get('/stats', requirePermission('tickets.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT status, COUNT(*) AS count
       FROM tickets
       WHERE organization_id = ? AND deleted_at IS NULL
       GROUP BY status`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /tickets/from-alert — create a ticket from an alert event
router.post('/from-alert', requirePermission('tickets.create'), async (req, res, next) => {
  try {
    const { alert_event_id, client_id, subject, description, priority } = req.body;
    if (!alert_event_id || !client_id || !subject) {
      return res.status(422).json({ error: 'alert_event_id, client_id, and subject are required' });
    }
    const [result] = await db.query(
      `INSERT INTO tickets
         (organization_id, client_id, subject, description, priority, status, source)
       VALUES (?, ?, ?, ?, ?, 'open', 'alert')`,
      [req.orgId, client_id, subject, description || null, priority || 'medium'],
    );
    const [[row]] = await db.query('SELECT * FROM tickets WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

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
      }).catch(err => logger.warn({ err: err.message, ticketId: record.id }, 'aiTriage enqueue failed on ticket create — AI reply will not be generated'));
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

router.put('/:id/comments/:commentId', requirePermission('tickets.update'), validate(updateComment), async (req, res, next) => {
  try {
    const { body, is_internal } = req.body;
    const [result] = await db.query(
      'UPDATE ticket_comments SET body = ?, is_internal = ? WHERE id = ? AND ticket_id = ? AND deleted_at IS NULL',
      [body, is_internal ?? false, req.params.commentId, req.params.id],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const [rows] = await db.query('SELECT * FROM ticket_comments WHERE id = ?', [req.params.commentId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id/comments/:commentId', requirePermission('tickets.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE ticket_comments SET deleted_at = NOW() WHERE id = ? AND ticket_id = ? AND deleted_at IS NULL',
      [req.params.commentId, req.params.id],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ticket relations
// ---------------------------------------------------------------------------
router.get('/:id/relations', requirePermission('ticket_relations.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT tr.*, ta.subject AS ticket_a_subject, tb.subject AS ticket_b_subject
       FROM ticket_relations tr
       JOIN tickets ta ON ta.id = tr.ticket_id_a
       JOIN tickets tb ON tb.id = tr.ticket_id_b
       WHERE tr.ticket_id_a = ? OR tr.ticket_id_b = ?`,
      [req.params.id, req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/relations', requirePermission('ticket_relations.manage'), async (req, res, next) => {
  try {
    const { related_ticket_id, relation_type } = req.body;
    if (!related_ticket_id) return res.status(422).json({ error: 'related_ticket_id is required' });
    const [result] = await db.query(
      'INSERT INTO ticket_relations (ticket_id_a, ticket_id_b, relation_type, created_by) VALUES (?, ?, ?, ?)',
      [req.params.id, related_ticket_id, relation_type || 'related', req.user.id],
    );
    const [[row]] = await db.query('SELECT * FROM ticket_relations WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

router.delete('/:id/relations/:relId', requirePermission('ticket_relations.manage'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM ticket_relations WHERE id = ? AND (ticket_id_a = ? OR ticket_id_b = ?)',
      [req.params.relId, req.params.id, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Relation not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ticket time logs
// ---------------------------------------------------------------------------
router.get('/:id/time-logs', requirePermission('ticket_time_logs.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT tl.*, u.first_name, u.last_name
       FROM ticket_time_logs tl
       LEFT JOIN users u ON u.id = tl.user_id
       WHERE tl.ticket_id = ?
       ORDER BY tl.work_date DESC, tl.created_at DESC`,
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/time-logs', requirePermission('ticket_time_logs.manage'), async (req, res, next) => {
  try {
    const { minutes, work_date, description } = req.body;
    if (!minutes || !work_date) {
      return res.status(422).json({ error: 'minutes and work_date are required' });
    }
    const [result] = await db.query(
      'INSERT INTO ticket_time_logs (ticket_id, user_id, minutes, work_date, description) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, req.user.id, minutes, work_date, description || null],
    );
    const [[row]] = await db.query('SELECT * FROM ticket_time_logs WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

router.put('/:id/time-logs/:logId', requirePermission('ticket_time_logs.manage'), async (req, res, next) => {
  try {
    const { minutes, work_date, description } = req.body;
    if (!minutes || !work_date) {
      return res.status(422).json({ error: 'minutes and work_date are required' });
    }
    const [result] = await db.query(
      'UPDATE ticket_time_logs SET minutes = ?, work_date = ?, description = ? WHERE id = ? AND ticket_id = ?',
      [minutes, work_date, description || null, req.params.logId, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Time log not found' });
    const [[row]] = await db.query('SELECT * FROM ticket_time_logs WHERE id = ?', [req.params.logId]);
    res.json({ data: row });
  } catch (err) { next(err); }
});

router.delete('/:id/time-logs/:logId', requirePermission('ticket_time_logs.manage'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM ticket_time_logs WHERE id = ? AND ticket_id = ?',
      [req.params.logId, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Time log not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ticket AI triage
// ---------------------------------------------------------------------------
router.get('/:id/ai-triage', requirePermission('tickets.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT * FROM ticket_ai_triage WHERE ticket_id = ?',
      [req.params.id],
    );
    if (!row) return res.status(404).json({ error: 'No triage result found for this ticket' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ticket AI summary
// ---------------------------------------------------------------------------
router.post('/:id/ai-summary', requirePermission('tickets.view'), async (req, res, next) => {
  try {
    const [[ticket]] = await db.query(
      'SELECT id, subject, description, organization_id, contract_id FROM tickets WHERE id = ? AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const result = await aiReplyService.generate({
      orgId:      ticket.organization_id,
      ticketId:   ticket.id,
      channel:    'portal',
      inboundText: ticket.description || ticket.subject,
      contractId: ticket.contract_id || null,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ticket merge
// ---------------------------------------------------------------------------
router.post('/:id/merge', requirePermission('tickets.update'), async (req, res, next) => {
  try {
    const { source_ticket_id } = req.body;
    if (!source_ticket_id) return res.status(422).json({ error: 'source_ticket_id is required' });
    // Move comments from source to target, then close source
    await db.query(
      'UPDATE ticket_comments SET ticket_id = ? WHERE ticket_id = ?',
      [req.params.id, source_ticket_id],
    );
    await db.query(
      `UPDATE tickets SET status = 'closed', deleted_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [source_ticket_id, req.orgId],
    );
    const [[row]] = await db.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    res.json({ data: { target: row, merged_from_id: Number(source_ticket_id) } });
  } catch (err) { next(err); }
});

module.exports = router;
