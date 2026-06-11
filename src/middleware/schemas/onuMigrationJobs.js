// =============================================================================
// FireISP 5.0 — ONU Migration Job Validation Schemas (§7.3)
// =============================================================================

const createOnuMigrationJob = {
  onu_device_id: { type: 'number', required: true, min: 1 },
  source_olt_port_id: { type: 'number', required: true, min: 1 },
  target_olt_port_id: { type: 'number', required: true, min: 1 },
  source_olt_device_id: { type: 'number', min: 1 },
  target_olt_device_id: { type: 'number', min: 1 },
  scheduled_at: { type: 'string', max: 30 },
  notes: { type: 'string', max: 1000 },
};

const updateOnuMigrationJob = {
  scheduled_at: { type: 'string', max: 30 },
  status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] },
  notes: { type: 'string', max: 1000 },
};

const patchOnuMigrationJob = Object.fromEntries(
  Object.entries(updateOnuMigrationJob).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOnuMigrationJob, updateOnuMigrationJob, patchOnuMigrationJob };
