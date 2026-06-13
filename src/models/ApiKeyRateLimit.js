// =============================================================================
// FireISP 5.0 — ApiKeyRateLimit Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ApiKeyRateLimit extends BaseModel {
  static get tableName() { return 'api_key_rate_limits'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'token_id', 'requests_per_minute', 'requests_per_hour', 'requests_per_day', 'burst_size'];
  }
}

module.exports = ApiKeyRateLimit;
