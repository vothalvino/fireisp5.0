// =============================================================================
// FireISP 5.0 — CpeSecurityScan Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeSecurityScan extends BaseModel {
  static get tableName() { return 'cpe_security_scans'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'device_id', 'cpe_device_id', 'scan_type', 'status', 'started_at', 'completed_at', 'findings', 'risk_level', 'triggered_by'];
  }
}

module.exports = CpeSecurityScan;
