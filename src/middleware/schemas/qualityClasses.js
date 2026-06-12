// =============================================================================
// FireISP 5.0 — QualityClass Validation Schemas
// =============================================================================

const createQualityClass = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  description: { type: 'string', max: 5000 },
  traffic_type: { type: 'string', enum: ['voip', 'video', 'web', 'download', 'other'] },
  priority: { type: 'number', min: 1, max: 8 },
  dscp_mark: { type: 'string', max: 20 },
  mikrotik_queue_kind: { type: 'string', enum: ['pcq', 'sfq', 'fifo', 'red', 'sfb'] },
  max_limit_pct: { type: 'number', min: 1, max: 100 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateQualityClass = {
  name: { type: 'string', min: 1, max: 100 },
  description: { type: 'string', max: 5000 },
  traffic_type: { type: 'string', enum: ['voip', 'video', 'web', 'download', 'other'] },
  priority: { type: 'number', min: 1, max: 8 },
  dscp_mark: { type: 'string', max: 20 },
  mikrotik_queue_kind: { type: 'string', enum: ['pcq', 'sfq', 'fifo', 'red', 'sfb'] },
  max_limit_pct: { type: 'number', min: 1, max: 100 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createQualityClass, updateQualityClass };
