// =============================================================================
// FireISP 5.0 — Suspension Rule Validation Schemas
// =============================================================================

// Field names match database/schema.sql's suspension_rules columns exactly —
// `validate()` silently drops any field not declared here, so `is_enabled` /
// `notify_days_before` (the real columns are `is_active` / `notify_before_days`)
// meant every create/update request lost the flag the operator actually set.
const createSuspensionRule = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  days_past_due: { type: 'number', required: true, min: 1 },
  grace_period_days: { type: 'number', min: 0 },
  action: { type: 'string', required: true, enum: ['auto_suspend', 'notify_only', 'auto_disconnect', 'soft_suspend'] },
  notify_before_days: { type: 'number', min: 0 },
  apply_to_plan_ids: { type: 'array' },
  is_active: { type: 'boolean' },
  soft_suspend_download_kbps: { type: 'number', min: 1 },
  soft_suspend_upload_kbps: { type: 'number', min: 1 },
};

const updateSuspensionRule = {
  name: { type: 'string', min: 1, max: 255 },
  days_past_due: { type: 'number', min: 1 },
  grace_period_days: { type: 'number', min: 0 },
  action: { type: 'string', enum: ['auto_suspend', 'notify_only', 'auto_disconnect', 'soft_suspend'] },
  notify_before_days: { type: 'number', min: 0 },
  apply_to_plan_ids: { type: 'array' },
  is_active: { type: 'boolean' },
  soft_suspend_download_kbps: { type: 'number', min: 1 },
  soft_suspend_upload_kbps: { type: 'number', min: 1 },
};

module.exports = { createSuspensionRule, updateSuspensionRule };
