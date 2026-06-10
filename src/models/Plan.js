// =============================================================================
// FireISP 5.0 — Plan Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Plan extends BaseModel {
  static get tableName() { return 'plans'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'description', 'download_speed_mbps',
      'upload_speed_mbps', 'price', 'currency', 'billing_cycle',
      'data_cap_gb', 'burst_download_mbps', 'burst_upload_mbps',
      'priority', 'status',
      'radius_vendor', 'radius_rate_limit_template',
      'fup_threshold_gb', 'fup_threshold_percent',
      'fup_download_speed_mbps', 'fup_upload_speed_mbps',
      'overage_mode', 'overage_price_per_gb',
      'trial_days', 'trial_price',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get add-ons available for this plan's organization.
   */
  static async getAddons(organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM plan_addons WHERE organization_id = ? AND status = ? AND deleted_at IS NULL ORDER BY name',
      [organizationId, 'active'],
    );
    return rows;
  }
}

module.exports = Plan;
