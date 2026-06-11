// =============================================================================
// FireISP 5.0 — ONU Firmware Job Validation Schemas (§7.2)
// =============================================================================

const createOnuFirmwareJob = {
  job_type: { type: 'string', required: true, enum: ['firmware_upgrade', 'reboot', 'provision', 'factory_reset', 'other'] },
  scope: { type: 'string', required: true, enum: ['single_onu', 'olt_port', 'olt_device', 'region', 'all'] },
  onu_device_id: { type: 'number', min: 1 },
  olt_device_id: { type: 'number', min: 1 },
  olt_port_id: { type: 'number', min: 1 },
  firmware_version: { type: 'string', max: 100 },
  firmware_url: { type: 'string', max: 1024 },
  scheduled_at: { type: 'string', max: 30 },
  notes: { type: 'string', max: 1000 },
};

const updateOnuFirmwareJob = {
  status: { type: 'string', enum: ['pending', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'partial'] },
  scheduled_at: { type: 'string', max: 30 },
  notes: { type: 'string', max: 1000 },
};

const patchOnuFirmwareJob = Object.fromEntries(
  Object.entries(updateOnuFirmwareJob).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOnuFirmwareJob, updateOnuFirmwareJob, patchOnuFirmwareJob };
