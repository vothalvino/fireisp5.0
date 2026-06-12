// =============================================================================
// FireISP 5.0 — QueueTreeNode Model
// =============================================================================

const BaseModel = require('./BaseModel');

class QueueTreeNode extends BaseModel {
  static get tableName() { return 'queue_tree_nodes'; }

  static get fillable() {
    return [
      'organization_id', 'parent_id', 'name', 'description', 'queue_type',
      'interface', 'max_limit_mbps', 'burst_limit_mbps', 'burst_threshold_mbps',
      'burst_time_seconds', 'priority', 'queue_kind', 'status', 'sort_order',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = QueueTreeNode;
