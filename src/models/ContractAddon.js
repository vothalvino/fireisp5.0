// =============================================================================
// FireISP 5.0 — ContractAddon Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ContractAddon extends BaseModel {
  static get tableName() { return 'contract_addons'; }

  static get fillable() {
    return [
      'organization_id', 'contract_id', 'plan_addon_id', 'quantity',
      'unit_price', 'start_date', 'end_date', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = ContractAddon;
