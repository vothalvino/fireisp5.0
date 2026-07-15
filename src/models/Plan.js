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
      'burst_threshold_mbps', 'burst_time_seconds',
      'priority', 'priority_class_id', 'status',
      'radius_vendor', 'radius_rate_limit_template',
      'fup_threshold_gb', 'fup_threshold_percent',
      'fup_download_speed_mbps', 'fup_upload_speed_mbps',
      'overage_mode', 'overage_price_per_gb',
      'trial_days', 'trial_price',
      'stack_type',
      'session_timeout_seconds', 'idle_timeout_seconds', 'simultaneous_use',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get add-ons available for this plan's organization. Inventory-linked
   * addons (inventory_item_id set) are enriched with `quantity_on_hand` — the
   * SUM of that item's stock across every warehouse — via a single grouped
   * LEFT JOIN (no N+1). `GROUP BY pa.id` is safe under ONLY_FULL_GROUP_BY
   * because every other selected `pa.*` column is functionally dependent on
   * the primary key. Non-linked addons (inventory_item_id NULL) always get
   * quantity_on_hand = 0 (COALESCE) — harmless since the frontend only shows
   * the figure when inventory_item_id is present.
   */
  static async getAddons(organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT pa.*, COALESCE(SUM(s.quantity), 0) AS quantity_on_hand
       FROM plan_addons pa
       LEFT JOIN inventory_stock s ON s.item_id = pa.inventory_item_id AND s.deleted_at IS NULL
       WHERE pa.organization_id = ? AND pa.status = ? AND pa.deleted_at IS NULL
       GROUP BY pa.id
       ORDER BY pa.name`,
      [organizationId, 'active'],
    );
    return rows;
  }
}

module.exports = Plan;
