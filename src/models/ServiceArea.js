// =============================================================================
// FireISP 5.0 — ServiceArea Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ServiceArea extends BaseModel {
  static get tableName() { return 'service_areas'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'name', 'description', 'boundary',
      'color', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = ServiceArea;
