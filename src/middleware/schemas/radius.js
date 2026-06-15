// =============================================================================
// FireISP 5.0 — RADIUS Validation Schemas
// =============================================================================

const createRadius = {
  client_id: { type: 'number', required: true, min: 1 },
  contract_id: { type: 'number', min: 1 },
  nas_id: { type: 'number', min: 1 },
  username: { type: 'string', required: true, min: 1, max: 64 },
  password: { type: 'string', required: true, min: 1, max: 255 },
  ip_address: { type: 'string', max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  ipv4_pool_id: { type: 'number', min: 1 },
  ipv6_pool_id: { type: 'number', min: 1 },
  ipv6_delegated_prefix: { type: 'string', max: 45 },
  ipv6_prefix_len: { type: 'number', min: 0, max: 128 },
  mac_address: { type: 'string', max: 17 },
  profile: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
  auth_method: { type: 'string', enum: ['pppoe', 'mac', 'dot1x', 'eap_tls'] },
  simultaneous_use: { type: 'number', min: 1, max: 255 },
  vlan_id: { type: 'number', min: 1, max: 4094 },
  inner_vlan_id: { type: 'number', min: 1, max: 4094 },
};

const updateRadius = {
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  nas_id: { type: 'number', min: 1 },
  username: { type: 'string', min: 1, max: 64 },
  password: { type: 'string', min: 1, max: 255 },
  ip_address: { type: 'string', max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  ipv4_pool_id: { type: 'number', min: 1 },
  ipv6_pool_id: { type: 'number', min: 1 },
  ipv6_delegated_prefix: { type: 'string', max: 45 },
  ipv6_prefix_len: { type: 'number', min: 0, max: 128 },
  mac_address: { type: 'string', max: 17 },
  profile: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
  auth_method: { type: 'string', enum: ['pppoe', 'mac', 'dot1x', 'eap_tls'] },
  simultaneous_use: { type: 'number', min: 1, max: 255 },
  vlan_id: { type: 'number', min: 1, max: 4094 },
  inner_vlan_id: { type: 'number', min: 1, max: 4094 },
};

const createRoute = {
  destination: { type: 'string', required: true, min: 1, max: 50 },
  gateway: { type: 'string', max: 45 },
  metric: { type: 'number', min: 0, max: 255 },
};

const updateWalledGarden = {
  enabled: { type: 'boolean' },
  redirect_url: { type: 'string', max: 500 },
  address_list_name: { type: 'string', min: 1, max: 100 },
  allowed_destinations: { type: 'string' },
};

module.exports = { createRadius, updateRadius, createRoute, updateWalledGarden };
