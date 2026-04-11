// =============================================================================
// FireISP 5.0 — Site Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Site extends BaseModel {
  static get tableName() { return 'sites'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'site_type', 'address', 'city',
      'state', 'zip_code', 'country', 'latitude', 'longitude',
      'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = Site;
