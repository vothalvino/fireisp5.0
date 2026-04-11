// =============================================================================
// FireISP 5.0 — ApiToken Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ApiToken extends BaseModel {
  static get tableName() { return 'api_tokens'; }

  static get fillable() {
    return [
      'organization_id', 'user_id', 'name', 'token_hash', 'scopes',
      'expires_at', 'revoked_at', 'last_used_at',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = ApiToken;
