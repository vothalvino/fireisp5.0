// =============================================================================
// FireISP 5.0 — Outage Validation Schemas
// =============================================================================

const createOutage = {
  title: { type: 'string', required: true, min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  outage_type: { type: 'string', enum: ['planned', 'unplanned'] },
  severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
  affected_area: { type: 'string', max: 500 },
  start_time: { type: 'string' },
  end_time: { type: 'string' },
  status: { type: 'string', enum: ['ongoing', 'resolved', 'post_mortem'] },
  notes: { type: 'string', max: 5000 },
};

const updateOutage = {
  title: { type: 'string', min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  outage_type: { type: 'string', enum: ['planned', 'unplanned'] },
  severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
  affected_area: { type: 'string', max: 500 },
  start_time: { type: 'string' },
  end_time: { type: 'string' },
  status: { type: 'string', enum: ['ongoing', 'resolved', 'post_mortem'] },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createOutage, updateOutage };
