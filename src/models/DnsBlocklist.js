// =============================================================================
// FireISP 5.0 — DnsBlocklist Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DnsBlocklist extends BaseModel {
  static get tableName() { return 'dns_blocklists'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'domain', 'category', 'reason', 'is_active', 'source', 'expires_at'];
  }
}

module.exports = DnsBlocklist;
