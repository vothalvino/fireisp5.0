// =============================================================================
// FireISP 5.0 — SlaDefinition Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SlaDefinition extends BaseModel {
  static get tableName() { return 'sla_definitions'; }

  static get fillable() {
    return [
      'organization_id', 'plan_id', 'name', 'uptime_pct',
      'max_response_minutes', 'max_resolution_minutes',
      'measurement_period', 'compensation_type', 'compensation_value',
      'exclude_maintenance', 'priority',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = SlaDefinition;
