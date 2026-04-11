// =============================================================================
// FireISP 5.0 — UserSession Model
// =============================================================================

const BaseModel = require('./BaseModel');

class UserSession extends BaseModel {
  static get tableName() { return 'user_sessions'; }
  static get fillable() { return ['user_id', 'token_hash', 'ip_address', 'user_agent', 'expires_at']; }
  static get hasOrgScope() { return false; }
}

module.exports = UserSession;
