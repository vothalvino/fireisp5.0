// =============================================================================
// FireISP 5.0 — NAS Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Nas extends BaseModel {
  static get tableName() { return 'nas'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'ip_address', 'ipv6_address',
      'secret', 'type', 'ports', 'coa_port', 'location', 'site_id',
      'secondary_nas_id', 'health_status', 'last_health_check_at',
      'description', 'status',
      // RouterOS direct-provisioning API connection (migration 360)
      'api_port', 'api_username', 'api_password_encrypted', 'api_use_tls',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Nas;
