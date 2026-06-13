// =============================================================================
// FireISP 5.0 — RemediationRule Model (§18.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class RemediationRule extends BaseModel {
  static get tableName() { return 'remediation_rules'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'description',
      'condition_metric', 'condition_operator', 'condition_threshold',
      'condition_duration_minutes', 'action_type', 'action_config',
      'cooldown_minutes', 'is_enabled', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = RemediationRule;
