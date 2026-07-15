// =============================================================================
// FireISP 5.0 — PlanAddon Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PlanAddon extends BaseModel {
  static get tableName() { return 'plan_addons'; }

  static get fillable() {
    return [
      'organization_id', 'plan_id', 'name', 'addon_type', 'inventory_item_id', 'price',
      'billing_cycle', 'taxable', 'description', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = PlanAddon;
