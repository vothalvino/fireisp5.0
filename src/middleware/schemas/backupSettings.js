// =============================================================================
// FireISP 5.0 — Remote Backup Settings Validation Schemas
// =============================================================================

const updateBackupSettings = {
  remote_enabled: { type: 'boolean' },
  provider: { type: 'string', enum: ['aws', 'gcs', 'b2', 'r2', 'minio', 'custom'] },
  bucket: { type: 'string', max: 255 },
  region: { type: 'string', max: 64 },
  endpoint: { type: 'string', max: 512 },
  prefix: { type: 'string', max: 255 },
  access_key: { type: 'string', max: 255 },
  // Three-state write-only field: omitted -> keep existing; '' -> clear;
  // non-empty -> re-encrypt and replace. See BackupSettings.upsert().
  secret_key: { type: 'string', max: 500 },
};

module.exports = { updateBackupSettings };
