// =============================================================================
// FireISP 5.0 — ONU Profile Validation Schemas (§7.2)
// =============================================================================

const createOnuProfile = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  technology: { type: 'string', enum: ['gpon', 'epon', 'xgspon', 'other'] },
  tcont_id: { type: 'number', min: 0, max: 7 },
  dba_profile_name: { type: 'string', max: 100 },
  assured_bw_kbps: { type: 'number', min: 0 },
  max_bw_kbps: { type: 'number', min: 0 },
  gem_port_id: { type: 'number', min: 0, max: 4095 },
  service_vlan: { type: 'number', min: 1, max: 4094 },
  client_vlan: { type: 'number', min: 1, max: 4094 },
  vlan_mode: { type: 'string', enum: ['transparent', 'tag', 'translate', 'double_tag', 'untagged'] },
  plan_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 1000 },
};

const updateOnuProfile = {
  name: { type: 'string', min: 1, max: 100 },
  technology: { type: 'string', enum: ['gpon', 'epon', 'xgspon', 'other'] },
  tcont_id: { type: 'number', min: 0, max: 7 },
  dba_profile_name: { type: 'string', max: 100 },
  assured_bw_kbps: { type: 'number', min: 0 },
  max_bw_kbps: { type: 'number', min: 0 },
  gem_port_id: { type: 'number', min: 0, max: 4095 },
  service_vlan: { type: 'number', min: 1, max: 4094 },
  client_vlan: { type: 'number', min: 1, max: 4094 },
  vlan_mode: { type: 'string', enum: ['transparent', 'tag', 'translate', 'double_tag', 'untagged'] },
  plan_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 1000 },
};

const patchOnuProfile = Object.fromEntries(
  Object.entries(updateOnuProfile).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOnuProfile, updateOnuProfile, patchOnuProfile };
