// =============================================================================
// FireISP 5.0 — CPE Profile Validation Schemas (§8.2)
// =============================================================================

const createCpeProfile = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  description: { type: 'string', max: 10000 },
  parent_profile_id: { type: 'number', min: 1 },
  plan_id: { type: 'number', min: 1 },
  manufacturer: { type: 'string', max: 100 },
  model_name: { type: 'string', max: 100 },
  wifi_ssid_template: { type: 'string', max: 64 },
  wifi_security: { type: 'string', max: 20 },
  wifi_channel: { type: 'number', min: 1, max: 165 },
  wifi_band: { type: 'string', enum: ['2.4GHz', '5GHz', 'dual'] },
  wan_mode: { type: 'string', enum: ['dhcp', 'pppoe', 'static'] },
  wan_vlan_id: { type: 'number', min: 1, max: 4094 },
  parameters: { type: 'object' },
  status: { type: 'string', enum: ['active', 'inactive', 'draft'] },
};

const updateCpeProfile = {
  name: { type: 'string', min: 1, max: 100 },
  description: { type: 'string', max: 10000 },
  parent_profile_id: { type: 'number', min: 1 },
  plan_id: { type: 'number', min: 1 },
  manufacturer: { type: 'string', max: 100 },
  model_name: { type: 'string', max: 100 },
  wifi_ssid_template: { type: 'string', max: 64 },
  wifi_security: { type: 'string', max: 20 },
  wifi_channel: { type: 'number', min: 1, max: 165 },
  wifi_band: { type: 'string', enum: ['2.4GHz', '5GHz', 'dual'] },
  wan_mode: { type: 'string', enum: ['dhcp', 'pppoe', 'static'] },
  wan_vlan_id: { type: 'number', min: 1, max: 4094 },
  parameters: { type: 'object' },
  status: { type: 'string', enum: ['active', 'inactive', 'draft'] },
};

module.exports = { createCpeProfile, updateCpeProfile };
