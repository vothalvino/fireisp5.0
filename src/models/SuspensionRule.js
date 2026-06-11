// =============================================================================
// FireISP 5.0 — SuspensionRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SuspensionRule extends BaseModel {
  static get tableName() { return 'suspension_rules'; }

  static get fillable() {
    return [
      'organization_id', 'days_past_due', 'grace_period_days', 'action',
      'notify_days_before', 'plan_ids', 'is_enabled',
      'soft_suspend_download_kbps', 'soft_suspend_upload_kbps',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = SuspensionRule;
