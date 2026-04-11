// =============================================================================
// FireISP 5.0 — IftStatisticalReport Model
// =============================================================================

const BaseModel = require('./BaseModel');

class IftStatisticalReport extends BaseModel {
  static get tableName() { return 'ift_statistical_reports'; }

  static get fillable() {
    return [
      'organization_id', 'report_period', 'subscribers_by_speed_tier',
      'subscribers_by_state', 'subscribers_by_technology',
      'avg_download_speed', 'avg_upload_speed',
      'coverage_municipalities', 'revenue', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = IftStatisticalReport;
