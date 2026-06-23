// =============================================================================
// FireISP 5.0 — Validation Schemas: Work Orders — §12.3
// =============================================================================
// work_orders is the single field-work / dispatch table (the legacy `jobs`
// table was consolidated in here in migration 363). A work order can target a
// subscriber (client_id), a POP/site (site_id), and/or a specific device
// (device_id), and optionally relate to a contract, originating service order,
// or ticket. The route enforces that a created work order targets at least one
// of client/site/device.
// =============================================================================

const TARGET_FIELDS = {
  client_id: { type: 'number', required: false },
  site_id: { type: 'number', required: false },
  device_id: { type: 'number', required: false },
  contract_id: { type: 'number', required: false },
  service_order_id: { type: 'number', required: false },
  work_type: { type: 'string', required: false, enum: ['installation','maintenance','repair','survey','other'] },
};

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
  ...TARGET_FIELDS,
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
  ...TARGET_FIELDS,
};

const patchWorkOrder = {
  title: { type: 'string', required: false, max: 255 },
  status: { type: 'string', required: false, enum: ['pending','assigned','in_progress','completed','cancelled'] },
  priority: { type: 'string', required: false, enum: ['low','medium','high','critical'] },
  assigned_to: { type: 'number', required: false },
  notes: { type: 'string', required: false },
  ...TARGET_FIELDS,
};

module.exports = { createWorkOrder, updateWorkOrder, patchWorkOrder };
