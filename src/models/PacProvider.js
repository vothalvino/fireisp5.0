// =============================================================================
// FireISP 5.0 — PacProvider Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PacProvider extends BaseModel {
  static get tableName() { return 'pac_providers'; }

  static get fillable() {
    return [
      'organization_id', 'provider_name', 'environment', 'username',
      'password_encrypted', 'api_url', 'is_default', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = PacProvider;
