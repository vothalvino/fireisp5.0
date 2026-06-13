// =============================================================================
// FireISP 5.0 — AutomationScript Model (§18.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class AutomationScript extends BaseModel {
  static get tableName() { return 'automation_scripts'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'description', 'language',
      'script_body', 'version', 'is_shared', 'tags',
      'scheduled_task_id', 'api_endpoint', 'created_by',
    ];
  }

  static get hasOrgScope() { return false; } // shared scripts have NULL org
  static get softDelete() { return true; }
}

module.exports = AutomationScript;
