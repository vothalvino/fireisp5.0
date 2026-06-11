// =============================================================================
// FireISP 5.0 — CPE Device Validation Schemas (§8.1)
// =============================================================================

const createCpeDevice = {
  serial_number: { type: 'string', required: true, min: 1, max: 64 },
  oui: { type: 'string', required: true, min: 6, max: 6 },
  product_class: { type: 'string', max: 64 },
  hardware_version: { type: 'string', max: 64 },
  software_version: { type: 'string', max: 64 },
  firmware_version: { type: 'string', max: 64 },
  manufacturer: { type: 'string', max: 100 },
  model_name: { type: 'string', max: 100 },
  acs_username: { type: 'string', max: 100 },
  device_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  cpe_profile_id: { type: 'number', min: 1 },
  status: { type: 'string', enum: ['new', 'provisioning', 'active', 'error', 'offline'] },
  wan_ip: { type: 'string', max: 45 },
  lan_subnet: { type: 'string', max: 18 },
  wifi_ssid: { type: 'string', max: 64 },
  notes: { type: 'string', max: 10000 },
};

const updateCpeDevice = {
  serial_number: { type: 'string', min: 1, max: 64 },
  oui: { type: 'string', min: 6, max: 6 },
  product_class: { type: 'string', max: 64 },
  hardware_version: { type: 'string', max: 64 },
  software_version: { type: 'string', max: 64 },
  firmware_version: { type: 'string', max: 64 },
  manufacturer: { type: 'string', max: 100 },
  model_name: { type: 'string', max: 100 },
  acs_username: { type: 'string', max: 100 },
  device_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  cpe_profile_id: { type: 'number', min: 1 },
  status: { type: 'string', enum: ['new', 'provisioning', 'active', 'error', 'offline'] },
  wan_ip: { type: 'string', max: 45 },
  lan_subnet: { type: 'string', max: 18 },
  wifi_ssid: { type: 'string', max: 64 },
  notes: { type: 'string', max: 10000 },
};

module.exports = { createCpeDevice, updateCpeDevice };
