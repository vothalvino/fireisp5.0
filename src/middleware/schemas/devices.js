// =============================================================================
// FireISP 5.0 — Device Validation Schemas
// =============================================================================

const createDevice = {
  site_id: { type: 'number', min: 1 },
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  name: { type: 'string', required: true, min: 1, max: 200 },
  type: { type: 'string', required: true, enum: ['outdoor_cpe', 'indoor_cpe', 'ptp', 'ptmp_ap', 'olt', 'router', 'switch', 'onu', 'other'] },
  manufacturer: { type: 'string', max: 100 },
  model: { type: 'string', max: 100 },
  serial_number: { type: 'string', max: 100 },
  mac_address: { type: 'string', max: 17 },
  ip_address: { type: 'string', max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  snmp_enabled: { type: 'boolean' },
  snmp_community: { type: 'string', max: 100 },
  snmp_version: { type: 'string', enum: ['v1', 'v2c', 'v3'] },
  snmp_port: { type: 'number', min: 1, max: 65535 },
  snmp_profile_id: { type: 'number', min: 1 },
  firmware: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['online', 'offline', 'maintenance'] },
};

const updateDevice = {
  site_id: { type: 'number', min: 1 },
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  name: { type: 'string', min: 1, max: 200 },
  type: { type: 'string', enum: ['outdoor_cpe', 'indoor_cpe', 'ptp', 'ptmp_ap', 'olt', 'router', 'switch', 'onu', 'other'] },
  manufacturer: { type: 'string', max: 100 },
  model: { type: 'string', max: 100 },
  serial_number: { type: 'string', max: 100 },
  mac_address: { type: 'string', max: 17 },
  ip_address: { type: 'string', max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  snmp_enabled: { type: 'boolean' },
  snmp_community: { type: 'string', max: 100 },
  snmp_version: { type: 'string', enum: ['v1', 'v2c', 'v3'] },
  snmp_port: { type: 'number', min: 1, max: 65535 },
  snmp_profile_id: { type: 'number', min: 1 },
  firmware: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['online', 'offline', 'maintenance'] },
};

const patchDevice = Object.fromEntries(
  Object.entries(updateDevice).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createDevice, updateDevice, patchDevice };
