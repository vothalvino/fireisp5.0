// =============================================================================
// FireISP 5.0 — QueueTreeNode Validation Schemas
// =============================================================================

const createQueueTreeNode = {
  parent_id: { type: 'number', min: 1 },
  name: { type: 'string', required: true, min: 1, max: 100 },
  description: { type: 'string', max: 5000 },
  queue_type: { type: 'string', enum: ['tree', 'simple'] },
  interface: { type: 'string', max: 100 },
  max_limit_mbps: { type: 'number', min: 0 },
  burst_limit_mbps: { type: 'number', min: 0 },
  burst_threshold_mbps: { type: 'number', min: 0 },
  burst_time_seconds: { type: 'number', min: 1, max: 255 },
  priority: { type: 'number', min: 1, max: 8 },
  queue_kind: { type: 'string', enum: ['pcq', 'sfq', 'fifo', 'red', 'sfb'] },
  status: { type: 'string', enum: ['active', 'inactive'] },
  sort_order: { type: 'number', min: 0, max: 65535 },
};

const updateQueueTreeNode = {
  parent_id: { type: 'number', min: 1 },
  name: { type: 'string', min: 1, max: 100 },
  description: { type: 'string', max: 5000 },
  queue_type: { type: 'string', enum: ['tree', 'simple'] },
  interface: { type: 'string', max: 100 },
  max_limit_mbps: { type: 'number', min: 0 },
  burst_limit_mbps: { type: 'number', min: 0 },
  burst_threshold_mbps: { type: 'number', min: 0 },
  burst_time_seconds: { type: 'number', min: 1, max: 255 },
  priority: { type: 'number', min: 1, max: 8 },
  queue_kind: { type: 'string', enum: ['pcq', 'sfq', 'fifo', 'red', 'sfb'] },
  status: { type: 'string', enum: ['active', 'inactive'] },
  sort_order: { type: 'number', min: 0, max: 65535 },
};

module.exports = { createQueueTreeNode, updateQueueTreeNode };
