// =============================================================================
// FireISP 5.0 — ProtocolShapingRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ProtocolShapingRule extends BaseModel {
  static get tableName() { return 'protocol_shaping_rules'; }

  static get fillable() {
    return [
      'organization_id', 'plan_id', 'name', 'description', 'protocol', 'direction',
      'dst_port_range', 'src_port_range', 'l7_pattern', 'action',
      'limit_download_mbps', 'limit_upload_mbps', 'dscp_mark',
      'priority', 'enabled', 'preset',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = ProtocolShapingRule;
