// =============================================================================
// FireISP 5.0 — Outage Validation Schemas
// =============================================================================

const createOutage = {
  site_id: { type: 'number' },
  device_id: { type: 'number' },
  title: { type: 'string', required: true, min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  outage_type: { type: 'string', enum: ['planned', 'unplanned'] },
  severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
  started_at: { type: 'string', required: true },
  resolved_at: { type: 'string' },
  affected_clients_count: { type: 'number', min: 0 },
  root_cause: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['ongoing', 'resolved', 'post_mortem'] },
};

const updateOutage = {
  site_id: { type: 'number' },
  device_id: { type: 'number' },
  title: { type: 'string', min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  outage_type: { type: 'string', enum: ['planned', 'unplanned'] },
  severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
  started_at: { type: 'string' },
  resolved_at: { type: 'string' },
  affected_clients_count: { type: 'number', min: 0 },
  root_cause: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['ongoing', 'resolved', 'post_mortem'] },
};

module.exports = { createOutage, updateOutage };
