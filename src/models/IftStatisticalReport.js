// =============================================================================
// FireISP 5.0 — IftStatisticalReport Model
// =============================================================================

const BaseModel = require('./BaseModel');

class IftStatisticalReport extends BaseModel {
  static get tableName() { return 'ift_statistical_reports'; }

  static get fillable() {
    return [
      'organization_id', 'concession_title_id',
      'report_period', 'period_start', 'period_end',
      'total_subscribers',
      'subscribers_by_speed_tier', 'subscribers_by_state',
      'subscribers_by_municipality', 'subscribers_by_technology',
      'subscribers_by_customer_type', 'subscribers_by_payment_modality',
      'coverage_localities', 'coverage_municipalities',
      'avg_download_speed_mbps', 'avg_upload_speed_mbps',
      'revenue_total',
      'filed_at', 'filing_id', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = IftStatisticalReport;
