// =============================================================================
// FireISP 5.0 — TaxRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class TaxRule extends BaseModel {
  static get tableName() { return 'tax_rules'; }
  static get fillable() { return ['organization_id', 'name', 'tax_type', 'rate', 'country', 'state', 'status']; }
  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = TaxRule;
