// =============================================================================
// FireISP 5.0 — PasswordPolicy Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PasswordPolicy extends BaseModel {
  static get tableName() { return 'password_policies'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'min_length', 'max_length', 'require_uppercase', 'require_lowercase', 'require_digits', 'require_symbols', 'rotation_days', 'history_count', 'lockout_attempts', 'lockout_duration_minutes'];
  }
}

module.exports = PasswordPolicy;
