// =============================================================================
// FireISP 5.0 — BlackholeRoute Model
// =============================================================================

const BaseModel = require('./BaseModel');

class BlackholeRoute extends BaseModel {
  static get tableName() { return 'blackhole_routes'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'prefix', 'subscriber_id', 'reason', 'triggered_by', 'triggered_by_user', 'ddos_rule_id', 'is_active', 'activated_at', 'expires_at', 'deactivated_at', 'deactivated_by', 'notes'];
  }
}

module.exports = BlackholeRoute;
