// =============================================================================
// FireISP 5.0 — SuspensionRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SuspensionRule extends BaseModel {
  static get tableName() { return 'suspension_rules'; }

  // Every name here must match database/schema.sql exactly — BaseModel builds
  // `INSERT/UPDATE ... (\`${col}\`)` directly from this list, so a wrong name
  // is a 500 at the DB, not a silent drop. This list previously used
  // `notify_days_before` (real: notify_before_days), `plan_ids` (real:
  // apply_to_plan_ids), and `is_enabled` (real: is_active) — none of which
  // exist — and was MISSING `name`, which is NOT NULL with no default, so it
  // was silently stripped from every create/update. Every suspension-rule
  // create/update via the API has 500'd since the original implementation.
  static get fillable() {
    return [
      'organization_id', 'name', 'days_past_due', 'grace_period_days', 'action',
      'notify_before_days', 'apply_to_plan_ids', 'is_active',
      'soft_suspend_download_kbps', 'soft_suspend_upload_kbps',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = SuspensionRule;
