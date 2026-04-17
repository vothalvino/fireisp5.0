// =============================================================================
// FireISP 5.0 — Ticket Validation Schemas
// =============================================================================

const createTicket = {
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  assigned_to: { type: 'number', min: 1 },
  subject: { type: 'string', required: true, min: 1, max: 300 },
  description: { type: 'string', max: 5000 },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  category: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
};

const updateTicket = {
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  assigned_to: { type: 'number', min: 1 },
  subject: { type: 'string', min: 1, max: 300 },
  description: { type: 'string', max: 5000 },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  category: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
};

const createComment = {
  body: { type: 'string', required: true, min: 1, max: 5000 },
  is_internal: { type: 'boolean' },
};

const patchTicket = Object.fromEntries(
  Object.entries(updateTicket).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createTicket, updateTicket, patchTicket, createComment };
