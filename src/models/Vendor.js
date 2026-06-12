// =============================================================================
// FireISP 5.0 — Vendor Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Vendor extends BaseModel {
  static get tableName() { return 'vendors'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'contact_name', 'email', 'phone',
      'website', 'address', 'tax_id', 'payment_terms', 'currency',
      'notes', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Vendor;
