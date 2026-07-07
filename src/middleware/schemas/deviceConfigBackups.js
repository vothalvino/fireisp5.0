// =============================================================================
// FireISP 5.0 — Device Config Backup Validation Schemas
// =============================================================================

const createDeviceConfigBackup = {
  device_id: { type: 'number', required: true, min: 1 },
  config_type: { type: 'string', enum: ['mikrotik_export', 'mikrotik_compact', 'mikrotik_backup', 'running_config', 'startup_config', 'full_backup', 'other'] },
  content: { type: 'string', required: true, min: 1 },
  checksum: { type: 'string', required: true, max: 64 },
  change_summary: { type: 'string', max: 5000 },
  capture_method: { type: 'string', enum: ['manual', 'scheduled', 'pre_change', 'post_change'] },
  notes: { type: 'string', max: 5000 },
};

const updateDeviceConfigBackup = {
  change_summary: { type: 'string', max: 5000 },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createDeviceConfigBackup, updateDeviceConfigBackup };
