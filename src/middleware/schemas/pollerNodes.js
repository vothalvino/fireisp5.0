// =============================================================================
// FireISP 5.0 — Validation schemas: Poller Nodes (§6.4)
// =============================================================================

const createPollerNode = {
  node_identifier: { type: 'string', required: true, min: 1, max: 64 },
  name:            { type: 'string', required: true, min: 1, max: 255 },
  status:          { type: 'string', enum: ['active', 'draining', 'maintenance', 'offline'] },
  api_url:         { type: 'string', max: 512 },
  max_concurrent_polls: { type: 'number', min: 1, max: 1000 },
};

const updatePollerNode = {
  node_identifier:     { type: 'string', min: 1, max: 64 },
  name:                { type: 'string', min: 1, max: 255 },
  status:              { type: 'string', enum: ['active', 'draining', 'maintenance', 'offline'] },
  api_url:             { type: 'string', max: 512 },
  max_concurrent_polls: { type: 'number', min: 1, max: 1000 },
  current_queue_depth:  { type: 'number', min: 0 },
  avg_poll_duration_ms: { type: 'number', min: 0 },
};

module.exports = { createPollerNode, updatePollerNode };
