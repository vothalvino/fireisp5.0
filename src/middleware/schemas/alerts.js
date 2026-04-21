// =============================================================================
// FireISP 5.0 — Alert Validation Schemas
// =============================================================================

const createRule = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', required: false },
  metric: { type: 'string', required: true },
  operator: { type: 'string', required: false },
  threshold: { type: 'number', required: true },
  device_id: { type: 'number', required: false },
  duration_minutes: { type: 'number', required: false },
  severity: { type: 'string', required: false },
  auto_create_outage: { type: 'boolean', required: false },
  auto_create_ticket: { type: 'boolean', required: false },
  is_enabled: { type: 'boolean', required: false },
};

const updateRule = {
  name: { type: 'string', required: false, min: 1, max: 200 },
  description: { type: 'string', required: false },
  metric: { type: 'string', required: false },
  operator: { type: 'string', required: false },
  threshold: { type: 'number', required: false },
  device_id: { type: 'number', required: false },
  duration_minutes: { type: 'number', required: false },
  severity: { type: 'string', required: false },
  auto_create_outage: { type: 'boolean', required: false },
  auto_create_ticket: { type: 'boolean', required: false },
  is_enabled: { type: 'boolean', required: false },
};

module.exports = { createRule, updateRule };
