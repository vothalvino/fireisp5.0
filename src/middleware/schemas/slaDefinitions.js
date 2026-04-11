// =============================================================================
// FireISP 5.0 — SLA Definition Validation Schemas
// =============================================================================

const createSlaDefinition = {
  plan_id: { type: 'number', min: 1 },
  name: { type: 'string', required: true, min: 1, max: 255 },
  uptime_pct: { type: 'number', min: 0, max: 100 },
  max_response_minutes: { type: 'number', min: 0 },
  max_resolution_minutes: { type: 'number', min: 0 },
  measurement_period: { type: 'string', enum: ['monthly', 'quarterly', 'annual'] },
  compensation_type: { type: 'string', enum: ['none', 'credit_percentage', 'credit_fixed', 'service_extension'] },
  compensation_value: { type: 'number', min: 0 },
  exclude_maintenance: { type: 'boolean' },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateSlaDefinition = {
  plan_id: { type: 'number', min: 1 },
  name: { type: 'string', min: 1, max: 255 },
  uptime_pct: { type: 'number', min: 0, max: 100 },
  max_response_minutes: { type: 'number', min: 0 },
  max_resolution_minutes: { type: 'number', min: 0 },
  measurement_period: { type: 'string', enum: ['monthly', 'quarterly', 'annual'] },
  compensation_type: { type: 'string', enum: ['none', 'credit_percentage', 'credit_fixed', 'service_extension'] },
  compensation_value: { type: 'number', min: 0 },
  exclude_maintenance: { type: 'boolean' },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createSlaDefinition, updateSlaDefinition };
