// =============================================================================
// FireISP 5.0 — FirewallRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class FirewallRule extends BaseModel {
  static get tableName() { return 'firewall_rules'; }
  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
  static get fillable() {
    return ['organization_id', 'name', 'description', 'action', 'protocol', 'src_ip', 'src_port', 'dst_ip', 'dst_port', 'priority', 'is_active', 'direction'];
  }
}

module.exports = FirewallRule;
