// =============================================================================
// FireISP 5.0 — Validation Schemas: Work Orders — §12.3
// =============================================================================

const createWorkOrder = {
  title: { type: 'string', required: true, max: 255 },
  description: { type: 'string', required: false },
  ticket_id: { type: 'number', required: false },
  assigned_to: { type: 'number', required: false },
  status: { type: 'string', required: false, enum: ['pending','assigned','in_progress','completed','cancelled'] },
  priority: { type: 'string', required: false, enum: ['low','medium','high','critical'] },
  scheduled_at: { type: 'string', required: false, format: 'date-time' },
  latitude: { type: 'number', required: false },
  longitude: { type: 'number', required: false },
  address: { type: 'string', required: false, max: 500 },
  notes: { type: 'string', required: false },
};

const updateWorkOrder = {
  title: { type: 'string', required: true, max: 255 },
  description: { type: 'string', required: false },
  ticket_id: { type: 'number', required: false },
  assigned_to: { type: 'number', required: false },
  status: { type: 'string', required: true, enum: ['pending','assigned','in_progress','completed','cancelled'] },
  priority: { type: 'string', required: true, enum: ['low','medium','high','critical'] },
  scheduled_at: { type: 'string', required: false, format: 'date-time' },
  started_at: { type: 'string', required: false, format: 'date-time' },
  completed_at: { type: 'string', required: false, format: 'date-time' },
  latitude: { type: 'number', required: false },
  longitude: { type: 'number', required: false },
  address: { type: 'string', required: false, max: 500 },
  notes: { type: 'string', required: false },
};

const patchWorkOrder = {
  title: { type: 'string', required: false, max: 255 },
  status: { type: 'string', required: false, enum: ['pending','assigned','in_progress','completed','cancelled'] },
  priority: { type: 'string', required: false, enum: ['low','medium','high','critical'] },
  assigned_to: { type: 'number', required: false },
  notes: { type: 'string', required: false },
};

module.exports = { createWorkOrder, updateWorkOrder, patchWorkOrder };
