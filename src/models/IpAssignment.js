// =============================================================================
// FireISP 5.0 — IpAssignment Model
// =============================================================================

const BaseModel = require('./BaseModel');

class IpAssignment extends BaseModel {
  static get tableName() { return 'ip_assignments'; }

  static get fillable() {
    return [
      'organization_id', 'ip_pool_id', 'client_id', 'contract_id',
      'device_id', 'ip_address', 'prefix_len', 'assignment_type',
      'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = IpAssignment;
