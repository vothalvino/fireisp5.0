// =============================================================================
// FireISP 5.0 — AutomationRule Model (§18.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class AutomationRule extends BaseModel {
  static get tableName() { return 'automation_rules'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'description', 'trigger_event',
      'trigger_conditions', 'action_type', 'action_config',
      'is_enabled', 'priority', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = AutomationRule;
