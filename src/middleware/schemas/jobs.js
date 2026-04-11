// =============================================================================
// FireISP 5.0 — Job Validation Schemas
// =============================================================================

const createJob = {
  client_id: { type: 'number', min: 1 },
  site_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  ticket_id: { type: 'number', min: 1 },
  assigned_to: { type: 'number', min: 1 },
  title: { type: 'string', required: true, min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  type: { type: 'string', enum: ['installation', 'maintenance', 'repair', 'survey', 'other'] },
  priority: { type: 'string', enum: ['low', 'medium', 'high'] },
  status: { type: 'string', enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] },
  scheduled_at: { type: 'string' },
  completed_at: { type: 'string' },
};

const updateJob = {
  client_id: { type: 'number', min: 1 },
  site_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  ticket_id: { type: 'number', min: 1 },
  assigned_to: { type: 'number', min: 1 },
  title: { type: 'string', min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  type: { type: 'string', enum: ['installation', 'maintenance', 'repair', 'survey', 'other'] },
  priority: { type: 'string', enum: ['low', 'medium', 'high'] },
  status: { type: 'string', enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] },
  scheduled_at: { type: 'string' },
  completed_at: { type: 'string' },
};

module.exports = { createJob, updateJob };
