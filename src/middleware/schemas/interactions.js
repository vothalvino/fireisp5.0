// =============================================================================
// FireISP 5.0 — Interaction Tracking Validation Schemas (§1.3)
// =============================================================================
// Covers client interactions, follow-up reminders, satisfaction surveys, and
// ticket escalations. See migration 196.
// =============================================================================

const INTERACTION_TYPES = ['call', 'email', 'sms', 'visit', 'chat', 'other'];
const DIRECTIONS = ['inbound', 'outbound'];
const REMINDER_PRIORITIES = ['low', 'medium', 'high'];
const REMINDER_STATUSES = ['pending', 'completed', 'cancelled'];
const SURVEY_TYPES = ['nps', 'csat'];
const SURVEY_CHANNELS = ['email', 'sms', 'portal', 'in_person'];
const SURVEY_STATUSES = ['pending', 'sent', 'responded', 'expired'];
const ESCALATION_STATUSES = ['open', 'acknowledged', 'resolved'];

// ---- Client interactions ----
const createInteraction = {
  client_id: { type: 'number', required: true, min: 1 },
  user_id: { type: 'number', min: 1 },
  interaction_type: { type: 'string', enum: INTERACTION_TYPES },
  direction: { type: 'string', enum: DIRECTIONS },
  subject: { type: 'string', required: true, min: 1, max: 300 },
  notes: { type: 'string', max: 65535 },
  occurred_at: { type: 'string', max: 30 },
  duration_minutes: { type: 'number', min: 0, max: 100000 },
};

const updateInteraction = Object.fromEntries(
  Object.entries(createInteraction).map(([k, v]) => [k, { ...v, required: false }]),
);

const patchInteraction = updateInteraction;

// ---- Follow-up reminders ----
const createFollowUp = {
  client_id: { type: 'number', required: true, min: 1 },
  interaction_id: { type: 'number', min: 1 },
  ticket_id: { type: 'number', min: 1 },
  assigned_to: { type: 'number', min: 1 },
  title: { type: 'string', required: true, min: 1, max: 200 },
  notes: { type: 'string', max: 65535 },
  priority: { type: 'string', enum: REMINDER_PRIORITIES },
  status: { type: 'string', enum: REMINDER_STATUSES },
  due_at: { type: 'string', required: true, max: 30 },
};

const updateFollowUp = Object.fromEntries(
  Object.entries(createFollowUp).map(([k, v]) => [k, { ...v, required: false }]),
);

const patchFollowUp = updateFollowUp;

// ---- Satisfaction surveys ----
const createSurvey = {
  client_id: { type: 'number', required: true, min: 1 },
  ticket_id: { type: 'number', min: 1 },
  interaction_id: { type: 'number', min: 1 },
  survey_type: { type: 'string', enum: SURVEY_TYPES },
  channel: { type: 'string', enum: SURVEY_CHANNELS },
  status: { type: 'string', enum: SURVEY_STATUSES },
};

const updateSurvey = Object.fromEntries(
  Object.entries(createSurvey).map(([k, v]) => [k, { ...v, required: false }]),
);

const patchSurvey = updateSurvey;

// Score range per type (NPS 0-10, CSAT 1-5) is enforced in interactionService.
const respondSurvey = {
  score: { type: 'number', required: true, min: 0, max: 10 },
  comment: { type: 'string', max: 65535 },
};

// ---- Ticket escalations ----
const createEscalation = {
  ticket_id: { type: 'number', required: true, min: 1 },
  escalated_to: { type: 'number', min: 1 },
  reason: { type: 'string', required: true, min: 1, max: 500 },
};

const transitionEscalation = {
  status: { type: 'string', required: true, enum: ['acknowledged', 'resolved'] },
  resolution_notes: { type: 'string', max: 65535 },
};

module.exports = {
  createInteraction, updateInteraction, patchInteraction,
  createFollowUp, updateFollowUp, patchFollowUp,
  createSurvey, updateSurvey, patchSurvey, respondSurvey,
  createEscalation, transitionEscalation,
  INTERACTION_TYPES, DIRECTIONS, REMINDER_PRIORITIES, REMINDER_STATUSES,
  SURVEY_TYPES, SURVEY_CHANNELS, SURVEY_STATUSES, ESCALATION_STATUSES,
};
