// =============================================================================
// FireISP 5.0 — TaxRate Model
// =============================================================================

const BaseModel = require('./BaseModel');

class TaxRate extends BaseModel {
  static get tableName() { return 'tax_rates'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'rate', 'description',
      'is_default', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = TaxRate;
