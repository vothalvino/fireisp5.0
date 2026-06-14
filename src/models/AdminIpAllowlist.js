// =============================================================================
// FireISP 5.0 — AdminIpAllowlist Model
// =============================================================================

const BaseModel = require('./BaseModel');

class AdminIpAllowlist extends BaseModel {
  static get tableName() { return 'admin_ip_allowlist'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'cidr', 'description', 'is_active', 'created_by'];
  }
}

module.exports = AdminIpAllowlist;
