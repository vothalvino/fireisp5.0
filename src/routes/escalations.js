// =============================================================================
// FireISP 5.0 — Ticket Escalation Routes (§1.3)
// =============================================================================

const { Router } = require('express');
const TicketEscalation = require('../models/TicketEscalation');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createEscalation, transitionEscalation } = require('../middleware/schemas/interactions');
const interactionService = require('../services/interactionService');
const auditLog = require('../services/auditLog');

const router = Router();
const ctrl = crudController(TicketEscalation, { cacheResource: 'escalations' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('escalations.view'), ctrl.list);

// Unresolved tickets without an open escalation — must precede '/:id'
router.get('/candidates', requirePermission('escalations.view'), async (req, res, next) => {
  try {
    const { userHasPermission } = require('../middleware/rbac');
    const rows = await interactionService.escalationCandidates(req.orgId, {
      hours: req.query.hours,
      limit: req.query.limit,
      // Billing-category tickets are gated by tickets.view_billing (mig 394)
      includeBillingTickets: await userHasPermission(req, 'tickets.view_billing'),
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('escalations.view'), ctrl.get);

// Escalate a ticket (level auto-increments per ticket)
router.post('/', requirePermission('escalations.create'), validate(createEscalation), async (req, res, next) => {
  try {
    const escalation = await interactionService.escalateTicket(req.body.ticket_id, {
      orgId: req.orgId,
      userId: req.user?.id ?? null,
      escalatedTo: req.body.escalated_to ?? null,
      reason: req.body.reason,
    });
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'escalate',
      tableName: 'tickets',
      recordId: req.body.ticket_id,
      newValues: { escalation_id: escalation.id, level: escalation.level, reason: escalation.reason },
    }).catch(() => {});
    res.status(201).json({ data: escalation });
  } catch (err) { next(err); }
});

// Acknowledge or resolve an escalation
router.post('/:id/transition', requirePermission('escalations.update'), validate(transitionEscalation), async (req, res, next) => {
  try {
    const escalation = await interactionService.transitionEscalation(req.params.id, req.orgId, {
      status: req.body.status,
      resolutionNotes: req.body.resolution_notes,
    });
    res.json({ data: escalation });
  } catch (err) { next(err); }
});

module.exports = router;
