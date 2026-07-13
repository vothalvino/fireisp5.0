// =============================================================================
// FireISP 5.0 — Email Settings Validation Schemas
// =============================================================================

const updateEmailSettings = {
  enabled: { type: 'boolean' },
  smtp_host: { type: 'string', max: 255 },
  smtp_port: { type: 'number', min: 1, max: 65535 },
  smtp_secure: { type: 'boolean' },
  smtp_user: { type: 'string', max: 255 },
  // Three-state write-only field: omitted -> keep existing; '' -> clear;
  // non-empty -> re-encrypt and replace. See EmailSettings.upsert().
  smtp_password: { type: 'string', max: 500 },
  from_email: { type: 'email', max: 255 },
  from_name: { type: 'string', max: 255 },
};

const testEmailSettings = {
  to: { type: 'email', required: true, max: 255 },
};

module.exports = { updateEmailSettings, testEmailSettings };
