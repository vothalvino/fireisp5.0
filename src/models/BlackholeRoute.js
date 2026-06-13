// =============================================================================
// FireISP 5.0 — BlackholeRoute Model
// =============================================================================

const BaseModel = require('./BaseModel');

class BlackholeRoute extends BaseModel {
  static get tableName() { return 'blackhole_routes'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'target_prefix', 'reason', 'next_hop', 'is_active', 'triggered_by', 'triggered_at', 'released_at', 'notes'];
  }
}

module.exports = BlackholeRoute;
