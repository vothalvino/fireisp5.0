// =============================================================================
// FireISP 5.0 — Device Config Backup Validation Schemas
// =============================================================================

const createDeviceConfigBackup = {
  device_id: { type: 'number', required: true, min: 1 },
  config_type: { type: 'string', enum: ['mikrotik_export', 'mikrotik_compact', 'mikrotik_backup', 'cisco_running', 'cisco_startup', 'ubiquiti_backup', 'generic_text', 'other'] },
  config_data: { type: 'string', required: true, min: 1 },
  version_label: { type: 'string', max: 100 },
  capture_method: { type: 'string', enum: ['manual', 'scheduled', 'pre_change', 'post_change'] },
  notes: { type: 'string', max: 5000 },
};

const updateDeviceConfigBackup = {
  version_label: { type: 'string', max: 100 },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createDeviceConfigBackup, updateDeviceConfigBackup };
