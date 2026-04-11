// =============================================================================
// FireISP 5.0 — PlanAddon Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PlanAddon extends BaseModel {
  static get tableName() { return 'plan_addons'; }

  static get fillable() {
    return [
      'organization_id', 'plan_id', 'name', 'addon_type', 'price',
      'billing_cycle', 'taxable', 'description', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = PlanAddon;
