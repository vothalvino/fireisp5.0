// =============================================================================
// FireISP 5.0 — Suspension Rule Validation Schemas
// =============================================================================

const createSuspensionRule = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  days_past_due: { type: 'number', required: true, min: 1 },
  grace_period_days: { type: 'number', min: 0 },
  action: { type: 'string', required: true, enum: ['auto_suspend', 'notify_only', 'auto_disconnect', 'soft_suspend'] },
  notify_days_before: { type: 'number', min: 0 },
  is_enabled: { type: 'boolean' },
  soft_suspend_download_kbps: { type: 'number', min: 1 },
  soft_suspend_upload_kbps: { type: 'number', min: 1 },
};

const updateSuspensionRule = {
  name: { type: 'string', min: 1, max: 255 },
  days_past_due: { type: 'number', min: 1 },
  grace_period_days: { type: 'number', min: 0 },
  action: { type: 'string', enum: ['auto_suspend', 'notify_only', 'auto_disconnect', 'soft_suspend'] },
  notify_days_before: { type: 'number', min: 0 },
  is_enabled: { type: 'boolean' },
  soft_suspend_download_kbps: { type: 'number', min: 1 },
  soft_suspend_upload_kbps: { type: 'number', min: 1 },
};

module.exports = { createSuspensionRule, updateSuspensionRule };
