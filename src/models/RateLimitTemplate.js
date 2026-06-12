// =============================================================================
// FireISP 5.0 — RateLimitTemplate Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RateLimitTemplate extends BaseModel {
  static get tableName() { return 'rate_limit_templates'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'description', 'service_type', 'radius_vendor',
      'download_mbps', 'upload_mbps', 'burst_download_mbps', 'burst_upload_mbps',
      'burst_threshold_mbps', 'burst_time_seconds', 'rate_string', 'priority', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = RateLimitTemplate;
