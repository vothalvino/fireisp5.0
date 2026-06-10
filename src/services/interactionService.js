// =============================================================================
// FireISP 5.0 — Interaction Tracking Service
// =============================================================================
// Implements isp-platform-features.md §1.3 "Interaction Tracking":
//   • activityTimeline      — unified per-client history across interactions,
//                             tickets, payments, emails, and SMS
//   • processDueReminders   — automated follow-up reminder notifications
//                             (scheduled task: follow_up_reminders)
//   • dispatchTicketSurveys — auto-create + send CSAT surveys for resolved
//                             tickets (scheduled task: dispatch_satisfaction_surveys)
//   • respondSurvey         — record an NPS/CSAT response with range validation
//   • surveyMetrics         — aggregate NPS score and CSAT average
//   • escalateTicket        — manual escalation with automatic level numbering
//   • autoEscalateTickets   — escalate stale unresolved tickets
//                             (scheduled task: auto_escalate_tickets)
//   • escalationCandidates  — unresolved tickets that have no open escalation
// =============================================================================

const db = require('../config/database');
const SatisfactionSurvey = require('../models/SatisfactionSurvey');
const TicketEscalation = require('../models/TicketEscalation');
const eventBus = require('./eventBus');
const logger = require('../utils/logger').child({ service: 'interactions' });
const { ValidationError, NotFoundError } = require('../utils/errors');

// Score ranges per survey type: NPS uses the 0-10 recommendation scale,
// CSAT the classic 1-5 satisfaction scale.
const SURVEY_SCORE_RANGES = {
  nps: { min: 0, max: 10 },
  csat: { min: 1, max: 5 },
};

/**
 * Unified activity timeline for a client — merges manual interactions,
 * tickets, payments, email/WhatsApp logs, and SMS logs into a single
 * reverse-chronological feed.
 *
 * @param {number} clientId
 * @param {number|null} organizationId
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @returns {Promise<{ client_id: number, events: object[] }>}
 */
async function activityTimeline(clientId, organizationId, { limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

  // email_logs has no organization_id column — it is scoped via the client.
  const [rows] = await db.queryReplica(`
    SELECT * FROM (
      SELECT 'interaction' AS event_type, ci.id AS reference_id,
             ci.interaction_type AS subtype, ci.subject AS title,
             ci.notes AS detail, ci.direction AS status, ci.occurred_at AS occurred_at
      FROM client_interactions ci
      WHERE ci.client_id = ? AND ci.deleted_at IS NULL
        AND (? IS NULL OR ci.organization_id = ?)

      UNION ALL

      SELECT 'ticket', t.id, t.priority, t.subject, t.category, t.status, t.created_at
      FROM tickets t
      WHERE t.client_id = ? AND t.deleted_at IS NULL
        AND (? IS NULL OR t.organization_id = ?)

      UNION ALL

      SELECT 'payment', p.id, p.payment_method,
             CONCAT(p.currency, ' ', p.amount), p.reference_number, p.status, p.created_at
      FROM payments p
      WHERE p.client_id = ? AND p.deleted_at IS NULL
        AND (? IS NULL OR p.organization_id = ?)

      UNION ALL

      SELECT 'email', el.id, el.channel, el.subject, el.recipient, el.status, el.created_at
      FROM email_logs el
      WHERE el.client_id = ?

      UNION ALL

      SELECT 'sms', sl.id, sl.channel, LEFT(sl.message_body, 160), sl.phone_number, sl.status, sl.created_at
      FROM sms_logs sl
      WHERE sl.client_id = ?
        AND (? IS NULL OR sl.organization_id = ?)
    ) AS timeline
    ORDER BY occurred_at DESC
    LIMIT ${safeLimit}
  `, [
    clientId, organizationId, organizationId,
    clientId, organizationId, organizationId,
    clientId, organizationId, organizationId,
    clientId,
    clientId, organizationId, organizationId,
  ]);

  return { client_id: Number(clientId), events: rows };
}

/**
 * Notify assignees about pending follow-up reminders that have come due and
 * have not been notified yet. Emits `followup.due` per reminder (handled by
 * notificationHooks) and stamps notified_at so each reminder fires once.
 *
 * @param {number|null} organizationId - NULL = all organizations
 * @returns {Promise<{ reminders_notified: number }>}
 */
async function processDueReminders(organizationId = null) {
  const [reminders] = await db.query(`
    SELECT r.*, cl.name AS client_name,
           u.email AS assignee_email, u.first_name AS assignee_first_name
    FROM follow_up_reminders r
    JOIN clients cl ON cl.id = r.client_id
    LEFT JOIN users u ON u.id = r.assigned_to
    WHERE r.status = 'pending'
      AND r.deleted_at IS NULL
      AND r.due_at <= NOW()
      AND r.notified_at IS NULL
      AND (? IS NULL OR r.organization_id = ?)
  `, [organizationId, organizationId]);

  let notified = 0;
  for (const reminder of reminders) {
    await db.query('UPDATE follow_up_reminders SET notified_at = NOW() WHERE id = ?', [reminder.id]);
    eventBus.emit('followup.due', {
      organizationId: reminder.organization_id ?? null,
      reminder,
    });
    notified++;
  }

  if (notified > 0) logger.info({ notified, organizationId }, 'Follow-up reminders notified');
  return { reminders_notified: notified };
}

/**
 * Create and send a CSAT survey for every ticket resolved within the last
 * `days` days that has no survey yet and whose client has an email address.
 * Emits `survey.requested` per survey (handled by notificationHooks).
 *
 * @param {number|null} organizationId - NULL = all organizations
 * @param {object} [options]
 * @param {number} [options.days=7] - Look-back window for resolved tickets
 * @returns {Promise<{ surveys_sent: number }>}
 */
async function dispatchTicketSurveys(organizationId = null, { days = 7 } = {}) {
  const safeDays = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);

  const [tickets] = await db.query(`
    SELECT t.id, t.organization_id, t.client_id, t.subject,
           cl.name AS client_name, cl.email AS client_email
    FROM tickets t
    JOIN clients cl ON cl.id = t.client_id AND cl.deleted_at IS NULL
    LEFT JOIN satisfaction_surveys s ON s.ticket_id = t.id AND s.deleted_at IS NULL
    WHERE t.status IN ('resolved', 'closed')
      AND t.deleted_at IS NULL
      AND t.resolved_at IS NOT NULL
      AND t.resolved_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      AND s.id IS NULL
      AND cl.email IS NOT NULL AND cl.email <> ''
      AND (? IS NULL OR t.organization_id = ?)
  `, [safeDays, organizationId, organizationId]);

  let sent = 0;
  for (const ticket of tickets) {
    const survey = await SatisfactionSurvey.create({
      organization_id: ticket.organization_id ?? null,
      client_id: ticket.client_id,
      ticket_id: ticket.id,
      survey_type: 'csat',
      channel: 'email',
      status: 'sent',
      sent_at: new Date(),
    });
    eventBus.emit('survey.requested', {
      organizationId: ticket.organization_id ?? null,
      survey,
      client: { id: ticket.client_id, name: ticket.client_name, email: ticket.client_email },
      ticket: { id: ticket.id, subject: ticket.subject },
    });
    sent++;
  }

  if (sent > 0) logger.info({ sent, organizationId }, 'Satisfaction surveys dispatched');
  return { surveys_sent: sent };
}

/**
 * Mark a pending survey as sent and emit `survey.requested` (manual dispatch).
 *
 * @param {number} surveyId
 * @param {number|null} orgId
 * @returns {Promise<object>} the updated survey
 */
async function sendSurvey(surveyId, orgId = null) {
  const survey = await SatisfactionSurvey.findById(surveyId, orgId);
  if (!survey) throw new NotFoundError('Survey');
  if (survey.status === 'responded') {
    throw new ValidationError('Survey has already been responded to');
  }

  const updated = await SatisfactionSurvey.update(surveyId, { status: 'sent', sent_at: new Date() }, orgId);

  const [clientRows] = await db.query(
    'SELECT id, name, email FROM clients WHERE id = ?',
    [survey.client_id],
  );
  eventBus.emit('survey.requested', {
    organizationId: survey.organization_id ?? null,
    survey: updated,
    client: clientRows[0] || { id: survey.client_id },
    ticket: null,
  });

  return updated;
}

/**
 * Record a survey response, validating the score against the survey type's
 * scale (NPS: 0-10, CSAT: 1-5).
 *
 * @param {number} surveyId
 * @param {number|null} orgId
 * @param {object} response
 * @param {number} response.score
 * @param {string} [response.comment]
 * @returns {Promise<object>} the updated survey
 */
async function respondSurvey(surveyId, orgId, { score, comment } = {}) {
  const survey = await SatisfactionSurvey.findById(surveyId, orgId);
  if (!survey) throw new NotFoundError('Survey');
  if (survey.status === 'responded') {
    throw new ValidationError('Survey has already been responded to');
  }

  const range = SURVEY_SCORE_RANGES[survey.survey_type];
  const numericScore = Number(score);
  if (!Number.isInteger(numericScore) || numericScore < range.min || numericScore > range.max) {
    throw new ValidationError(
      `Score for a ${survey.survey_type.toUpperCase()} survey must be an integer between ${range.min} and ${range.max}`,
    );
  }

  return SatisfactionSurvey.update(surveyId, {
    score: numericScore,
    comment: comment ?? null,
    status: 'responded',
    responded_at: new Date(),
  }, orgId);
}

/**
 * Aggregate NPS and CSAT metrics over a recent window.
 * NPS score = %promoters (9-10) − %detractors (0-6), rounded.
 * CSAT satisfaction = % of responses scoring 4 or 5.
 *
 * @param {number|null} organizationId
 * @param {object} [options]
 * @param {number} [options.months=6]
 */
async function surveyMetrics(organizationId, { months = 6 } = {}) {
  const safeMonths = Math.min(Math.max(parseInt(months, 10) || 6, 1), 36);

  const [rows] = await db.queryReplica(`
    SELECT
      survey_type,
      COUNT(*) AS total,
      SUM(status = 'responded') AS responses,
      SUM(survey_type = 'nps' AND status = 'responded' AND score >= 9) AS promoters,
      SUM(survey_type = 'nps' AND status = 'responded' AND score BETWEEN 7 AND 8) AS passives,
      SUM(survey_type = 'nps' AND status = 'responded' AND score <= 6) AS detractors,
      SUM(survey_type = 'csat' AND status = 'responded' AND score >= 4) AS satisfied,
      AVG(CASE WHEN status = 'responded' THEN score END) AS avg_score
    FROM satisfaction_surveys
    WHERE deleted_at IS NULL
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
      AND (? IS NULL OR organization_id = ?)
    GROUP BY survey_type
  `, [safeMonths, organizationId, organizationId]);

  const result = {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    months: safeMonths,
    nps: { sent: 0, responses: 0, promoters: 0, passives: 0, detractors: 0, score: null },
    csat: { sent: 0, responses: 0, satisfied: 0, average: null, satisfaction_pct: null },
  };

  for (const r of rows) {
    const responses = Number(r.responses) || 0;
    if (r.survey_type === 'nps') {
      const promoters = Number(r.promoters) || 0;
      const detractors = Number(r.detractors) || 0;
      result.nps = {
        sent: Number(r.total) || 0,
        responses,
        promoters,
        passives: Number(r.passives) || 0,
        detractors,
        score: responses > 0 ? Math.round(((promoters - detractors) / responses) * 100) : null,
      };
    } else if (r.survey_type === 'csat') {
      const satisfied = Number(r.satisfied) || 0;
      result.csat = {
        sent: Number(r.total) || 0,
        responses,
        satisfied,
        average: r.avg_score !== null ? Math.round(Number(r.avg_score) * 100) / 100 : null,
        satisfaction_pct: responses > 0 ? Math.round((satisfied / responses) * 100) : null,
      };
    }
  }

  return result;
}

/**
 * Manually escalate a ticket. The escalation level is auto-incremented from
 * the ticket's highest existing escalation. Emits `ticket.escalated`.
 *
 * @param {number} ticketId
 * @param {object} options
 * @param {number|null} [options.orgId]
 * @param {number|null} [options.userId] - escalating user (NULL = system)
 * @param {number|null} [options.escalatedTo]
 * @param {string} options.reason
 * @returns {Promise<object>} the created escalation
 */
async function escalateTicket(ticketId, { orgId = null, userId = null, escalatedTo = null, reason } = {}) {
  const [ticketRows] = await db.query(
    'SELECT * FROM tickets WHERE id = ? AND deleted_at IS NULL' + (orgId !== null ? ' AND organization_id = ?' : ''),
    orgId !== null ? [ticketId, orgId] : [ticketId],
  );
  const ticket = ticketRows[0];
  if (!ticket) throw new NotFoundError('Ticket');
  if (['resolved', 'closed'].includes(ticket.status)) {
    throw new ValidationError('Cannot escalate a resolved or closed ticket');
  }

  const [[{ max_level: maxLevel }]] = await db.query(
    'SELECT COALESCE(MAX(level), 0) AS max_level FROM ticket_escalations WHERE ticket_id = ?',
    [ticketId],
  );

  const escalation = await TicketEscalation.create({
    organization_id: ticket.organization_id ?? orgId ?? null,
    ticket_id: ticket.id,
    level: Number(maxLevel) + 1,
    escalated_by: userId,
    escalated_to: escalatedTo ?? ticket.assigned_to ?? null,
    reason,
    status: 'open',
  });

  eventBus.emit('ticket.escalated', {
    organizationId: ticket.organization_id ?? orgId ?? null,
    escalation,
    ticket: { id: ticket.id, subject: ticket.subject, client_id: ticket.client_id },
  });

  logger.info({ ticketId: ticket.id, level: escalation.level }, 'Ticket escalated');
  return escalation;
}

/**
 * Auto-escalate unresolved tickets older than `hours` that have no escalation
 * yet. Used by the `auto_escalate_tickets` scheduled task.
 *
 * @param {number|null} organizationId - NULL = all organizations
 * @param {object} [options]
 * @param {number} [options.hours=48]
 * @returns {Promise<{ tickets_escalated: number }>}
 */
async function autoEscalateTickets(organizationId = null, { hours = 48 } = {}) {
  const safeHours = Math.min(Math.max(parseInt(hours, 10) || 48, 1), 720);

  const [tickets] = await db.query(`
    SELECT t.id
    FROM tickets t
    LEFT JOIN ticket_escalations e ON e.ticket_id = t.id
    WHERE t.status IN ('open', 'in_progress')
      AND t.deleted_at IS NULL
      AND t.created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
      AND e.id IS NULL
      AND (? IS NULL OR t.organization_id = ?)
  `, [safeHours, organizationId, organizationId]);

  let escalated = 0;
  for (const { id } of tickets) {
    try {
      await escalateTicket(id, {
        orgId: organizationId,
        reason: `Automatic escalation: ticket unresolved for more than ${safeHours} hours`,
      });
      escalated++;
    } catch (err) {
      logger.warn({ err: err.message, ticketId: id }, 'Auto-escalation failed for ticket');
    }
  }

  return { tickets_escalated: escalated };
}

/**
 * Unresolved tickets older than `hours` with no open escalation — the work
 * queue surfaced in the escalation management UI.
 *
 * @param {number|null} organizationId
 * @param {object} [options]
 * @param {number} [options.hours=24]
 * @param {number} [options.limit=50]
 */
async function escalationCandidates(organizationId, { hours = 24, limit = 50 } = {}) {
  const safeHours = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 720);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  const [rows] = await db.queryReplica(`
    SELECT t.id, t.subject, t.priority, t.status, t.created_at,
           cl.id AS client_id, cl.name AS client_name,
           TIMESTAMPDIFF(HOUR, t.created_at, NOW()) AS hours_open
    FROM tickets t
    JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN ticket_escalations e ON e.ticket_id = t.id AND e.status <> 'resolved'
    WHERE t.status IN ('open', 'in_progress', 'waiting')
      AND t.deleted_at IS NULL
      AND t.created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
      AND e.id IS NULL
      AND (? IS NULL OR t.organization_id = ?)
    ORDER BY FIELD(t.priority, 'critical', 'high', 'medium', 'low'), t.created_at ASC
    LIMIT ${safeLimit}
  `, [safeHours, organizationId, organizationId]);

  return rows;
}

/**
 * Transition an escalation to `acknowledged` or `resolved`, stamping the
 * matching timestamp column.
 *
 * @param {number} escalationId
 * @param {number|null} orgId
 * @param {object} options
 * @param {'acknowledged'|'resolved'} options.status
 * @param {string} [options.resolutionNotes]
 * @returns {Promise<object>} the updated escalation
 */
async function transitionEscalation(escalationId, orgId, { status, resolutionNotes } = {}) {
  const escalation = await TicketEscalation.findById(escalationId, orgId);
  if (!escalation) throw new NotFoundError('Escalation');

  const allowed = { open: ['acknowledged', 'resolved'], acknowledged: ['resolved'] };
  if (!(allowed[escalation.status] || []).includes(status)) {
    throw new ValidationError(`Invalid escalation transition: ${escalation.status} → ${status}`);
  }

  const updates = { status };
  if (status === 'acknowledged') updates.acknowledged_at = new Date();
  if (status === 'resolved') {
    updates.resolved_at = new Date();
    if (resolutionNotes !== undefined) updates.resolution_notes = resolutionNotes;
  }

  return TicketEscalation.update(escalationId, updates, orgId);
}

module.exports = {
  SURVEY_SCORE_RANGES,
  activityTimeline,
  processDueReminders,
  dispatchTicketSurveys,
  sendSurvey,
  respondSurvey,
  surveyMetrics,
  escalateTicket,
  autoEscalateTickets,
  escalationCandidates,
  transitionEscalation,
};
