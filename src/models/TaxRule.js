// =============================================================================
// FireISP 5.0 — TaxRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class TaxRule extends BaseModel {
  static get tableName() { return 'tax_rules'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'region', 'postal_codes', 'tax_type', 'rate',
      'is_default', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = TaxRule;
