// =============================================================================
// FireISP 5.0 — CpeTask Model (§8.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeTask extends BaseModel {
  static get tableName() { return 'cpe_tasks'; }

  static get fillable() {
    return [
      'organization_id', 'cpe_device_id', 'task_type', 'parameters',
      'status', 'priority', 'result', 'error_message', 'created_by',
      'queued_at', 'started_at', 'completed_at',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return false; }
}

module.exports = CpeTask;
