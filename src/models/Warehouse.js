// =============================================================================
// FireISP 5.0 — Warehouse Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Warehouse extends BaseModel {
  static get tableName() { return 'warehouses'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'address', 'city', 'state',
      'zip_code', 'country', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = Warehouse;
