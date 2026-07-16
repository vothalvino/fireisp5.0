// =============================================================================
// FireISP 5.0 — Ticket Validation Schemas
// =============================================================================

// Ticket taxonomy (migration 394) — mirrors the tickets.category ENUM. A staff
// ticket cannot be saved without picking one; billing-category tickets are
// gated by the tickets.view_billing permission.
const TICKET_CATEGORIES = ['technical', 'billing', 'installation', 'general'];

const createTicket = {
  // tickets.client_id is NOT NULL in the schema — omitting it used to reach
  // the INSERT and 500. Required here so the API answers 422 with a message.
  client_id: { type: 'number', required: true, min: 1 },
  contract_id: { type: 'number', min: 1 },
  assigned_to: { type: 'number', min: 1 },
  subject: { type: 'string', required: true, min: 1, max: 300 },
  description: { type: 'string', max: 5000 },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  category: { type: 'string', required: true, enum: TICKET_CATEGORIES },
  status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
};

const updateTicket = {
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  assigned_to: { type: 'number', min: 1 },
  subject: { type: 'string', min: 1, max: 300 },
  description: { type: 'string', max: 5000 },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  category: { type: 'string', enum: TICKET_CATEGORIES },
  status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
};

const createComment = {
  body: { type: 'string', required: true, min: 1, max: 5000 },
  is_internal: { type: 'boolean' },
};

const updateComment = {
  body: { type: 'string', required: true, min: 1, max: 5000 },
  is_internal: { type: 'boolean' },
};

const patchTicket = Object.fromEntries(
  Object.entries(updateTicket).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createTicket, updateTicket, patchTicket, createComment, updateComment };
