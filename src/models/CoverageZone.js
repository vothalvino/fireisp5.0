// =============================================================================
// FireISP 5.0 — CoverageZone Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CoverageZone extends BaseModel {
  static get tableName() { return 'coverage_zones'; }

  static get fillable() {
    return [
      'organization_id', 'service_area_id', 'name', 'zone_type',
      'boundary', 'max_download_mbps', 'max_upload_mbps', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = CoverageZone;
