// =============================================================================
// FireISP 5.0 — OTDR Test Result Validation Schemas (§7.4)
// =============================================================================

const TEST_TYPES = ['manual', 'scheduled', 'fault_locate', 'baseline', 'acceptance'];
const FAULT_TYPES = ['reflection', 'break', 'high_splice', 'end_of_fiber', 'unknown'];
const JOB_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'imported'];

const createOtdrTest = {
  fiber_route_id: { type: 'number', min: 1 },
  olt_port_id: { type: 'number', min: 1 },
  olt_device_id: { type: 'number', min: 1 },
  test_type: { type: 'string', enum: TEST_TYPES },
  wavelength_nm: { type: 'number', min: 800, max: 2000 },
  pulse_width_ns: { type: 'number', min: 1 },
  range_m: { type: 'number', min: 1 },
  total_loss_db: { type: 'number', min: 0 },
  total_length_m: { type: 'number', min: 0 },
  fault_detected: { type: 'number', min: 0, max: 1 },
  fault_distance_m: { type: 'number', min: 0 },
  fault_type: { type: 'string', enum: FAULT_TYPES },
  sor_file_path: { type: 'string', max: 512 },
  job_status: { type: 'string', enum: JOB_STATUSES },
  tested_at: { type: 'string', max: 30 },
  notes: { type: 'string', max: 2000 },
};

const updateOtdrTest = {
  fiber_route_id: { type: 'number', min: 1 },
  olt_port_id: { type: 'number', min: 1 },
  test_type: { type: 'string', enum: TEST_TYPES },
  wavelength_nm: { type: 'number', min: 800, max: 2000 },
  total_loss_db: { type: 'number', min: 0 },
  total_length_m: { type: 'number', min: 0 },
  fault_detected: { type: 'number', min: 0, max: 1 },
  fault_distance_m: { type: 'number', min: 0 },
  fault_type: { type: 'string', enum: FAULT_TYPES },
  job_status: { type: 'string', enum: JOB_STATUSES },
  notes: { type: 'string', max: 2000 },
};

const patchOtdrTest = Object.fromEntries(
  Object.entries(updateOtdrTest).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOtdrTest, updateOtdrTest, patchOtdrTest };
