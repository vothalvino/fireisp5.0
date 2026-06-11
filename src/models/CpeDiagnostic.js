// =============================================================================
// FireISP 5.0 — CpeDiagnostic Model (§8.3)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeDiagnostic extends BaseModel {
  static get tableName() { return 'cpe_diagnostics'; }

  static get fillable() {
    return [
      'organization_id', 'cpe_device_id', 'cpe_task_id', 'diag_type',
      'status', 'target_host', 'result', 'error_message',
      'started_at', 'completed_at',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = CpeDiagnostic;
