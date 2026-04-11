// =============================================================================
// FireISP 5.0 — NAS Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Nas extends BaseModel {
  static get tableName() { return 'nas'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'ip_address', 'ipv6_address',
      'secret', 'type', 'description', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = Nas;
