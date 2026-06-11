// =============================================================================
// FireISP 5.0 — Wireless Sector/AP Validation Schemas (§9.1)
// =============================================================================

// ---------------------------------------------------------------------------
// ap_channel_plans
// ---------------------------------------------------------------------------
const createApChannelPlan = {
  site_id:           { type: 'number', required: true, min: 1 },
  name:              { type: 'string', required: true, max: 100 },
  frequency_mhz:     { type: 'number', required: true, min: 1 },
  channel_width_mhz: { type: 'number', required: true, min: 1 },
  notes:             { type: 'string', max: 5000 },
  status:            { type: 'string', enum: ['active', 'inactive'] },
};

const updateApChannelPlan = {
  site_id:           { type: 'number', min: 1 },
  name:              { type: 'string', max: 100 },
  frequency_mhz:     { type: 'number', min: 1 },
  channel_width_mhz: { type: 'number', min: 1 },
  notes:             { type: 'string', max: 5000 },
  status:            { type: 'string', enum: ['active', 'inactive'] },
};

// ---------------------------------------------------------------------------
// ap_sector_configs
// ---------------------------------------------------------------------------
const createApSectorConfig = {
  device_id:          { type: 'number', required: true, min: 1 },
  sector_azimuth_deg: { type: 'number', min: 0, max: 359 },
  sector_width_deg:   { type: 'number', min: 1, max: 360 },
  frequency_mhz:      { type: 'number', min: 1 },
  channel_width_mhz:  { type: 'number', min: 1 },
  tx_power_dbm:       { type: 'number', min: -30, max: 60 },
  encryption:         { type: 'string', enum: ['none', 'wpa2', 'wpa3', 'mixed'] },
  channel_plan_id:    { type: 'number', min: 1 },
  antenna_gain_dbi:   { type: 'number', min: 0, max: 60 },
  height_m:           { type: 'number', min: 0, max: 999.9 },
  polarization:       { type: 'string', enum: ['vertical', 'horizontal', 'dual', 'cross'] },
  max_clients:        { type: 'number', min: 1, max: 32767 },
  notes:              { type: 'string', max: 5000 },
};

const updateApSectorConfig = {
  device_id:          { type: 'number', min: 1 },
  sector_azimuth_deg: { type: 'number', min: 0, max: 359 },
  sector_width_deg:   { type: 'number', min: 1, max: 360 },
  frequency_mhz:      { type: 'number', min: 1 },
  channel_width_mhz:  { type: 'number', min: 1 },
  tx_power_dbm:       { type: 'number', min: -30, max: 60 },
  encryption:         { type: 'string', enum: ['none', 'wpa2', 'wpa3', 'mixed'] },
  channel_plan_id:    { type: 'number', min: 1 },
  antenna_gain_dbi:   { type: 'number', min: 0, max: 60 },
  height_m:           { type: 'number', min: 0, max: 999.9 },
  polarization:       { type: 'string', enum: ['vertical', 'horizontal', 'dual', 'cross'] },
  max_clients:        { type: 'number', min: 1, max: 32767 },
  notes:              { type: 'string', max: 5000 },
};

// ---------------------------------------------------------------------------
// ap_command_jobs
// ---------------------------------------------------------------------------
const createApCommandJob = {
  device_id:     { type: 'number', required: true, min: 1 },
  command_type:  { type: 'string', required: true, enum: ['set_tx_power', 'set_frequency', 'set_channel_width', 'reboot', 'other'] },
  target_value:  { type: 'string', max: 255 },
  scheduled_at:  { type: 'string' },
  notes:         { type: 'string', max: 5000 },
};

const updateApCommandJob = {
  command_type: { type: 'string', enum: ['set_tx_power', 'set_frequency', 'set_channel_width', 'reboot', 'other'] },
  target_value: { type: 'string', max: 255 },
  status:       { type: 'string', enum: ['pending', 'queued', 'in_progress', 'completed', 'failed', 'cancelled'] },
  scheduled_at: { type: 'string' },
  notes:        { type: 'string', max: 5000 },
};

// ---------------------------------------------------------------------------
// wireless_channel_interference
// ---------------------------------------------------------------------------
const createChannelInterference = {
  ap_sector_config_id: { type: 'number', min: 1 },
  site_id:             { type: 'number', min: 1 },
  detected_at:         { type: 'string', required: true },
  frequency_mhz:       { type: 'number', min: 1 },
  channel_width_mhz:   { type: 'number', min: 1 },
  interference_level:  { type: 'string', required: true, enum: ['low', 'medium', 'high', 'critical'] },
  conflicting_ap_mac:  { type: 'string', max: 17 },
  notes:               { type: 'string', max: 5000 },
};

const updateChannelInterference = {
  ap_sector_config_id: { type: 'number', min: 1 },
  site_id:             { type: 'number', min: 1 },
  detected_at:         { type: 'string' },
  frequency_mhz:       { type: 'number', min: 1 },
  channel_width_mhz:   { type: 'number', min: 1 },
  interference_level:  { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  conflicting_ap_mac:  { type: 'string', max: 17 },
  notes:               { type: 'string', max: 5000 },
};

module.exports = {
  createApChannelPlan,
  updateApChannelPlan,
  createApSectorConfig,
  updateApSectorConfig,
  createApCommandJob,
  updateApCommandJob,
  createChannelInterference,
  updateChannelInterference,
};
