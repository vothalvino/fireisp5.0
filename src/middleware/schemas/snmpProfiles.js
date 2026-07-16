// =============================================================================
// FireISP 5.0 — SNMP Profile Validation Schemas
// =============================================================================

const createSnmpProfile = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  manufacturer: { type: 'string', max: 100 },
  model_pattern: { type: 'string', max: 255 },
  device_type: { type: 'string', enum: ['outdoor_cpe', 'indoor_cpe', 'ptp', 'ptmp_ap', 'olt', 'router', 'switch', 'onu', 'other'] },
  snmp_version: { type: 'string', enum: ['v1', 'v2c', 'v3'] },
  poll_interval_sec: { type: 'number', min: 10, max: 86400 },
  description: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateSnmpProfile = {
  name: { type: 'string', min: 1, max: 255 },
  manufacturer: { type: 'string', max: 100 },
  model_pattern: { type: 'string', max: 255 },
  device_type: { type: 'string', enum: ['outdoor_cpe', 'indoor_cpe', 'ptp', 'ptmp_ap', 'olt', 'router', 'switch', 'onu', 'other'] },
  snmp_version: { type: 'string', enum: ['v1', 'v2c', 'v3'] },
  poll_interval_sec: { type: 'number', min: 10, max: 86400 },
  description: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const createSnmpProfileOid = {
  oid: { type: 'string', required: true, min: 1, max: 255 },
  label: { type: 'string', required: true, min: 1, max: 255 },
  oid_type: { type: 'string', enum: ['gauge', 'counter', 'counter64', 'string', 'timeticks'] },
  description: { type: 'string', max: 500 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  metric_column: { type: 'string', required: true, min: 1, max: 64 },
  is_per_interface: { type: 'boolean' },
  aggregate: { type: 'boolean' },
  sort_order: { type: 'number', min: 0 },
};

module.exports = { createSnmpProfile, updateSnmpProfile, createSnmpProfileOid };
