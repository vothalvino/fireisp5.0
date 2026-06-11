// =============================================================================
// FireISP 5.0 — ONU OMCI Config Validation Schemas (§7.2)
// =============================================================================

const createOnuOmciConfig = {
  device_id: { type: 'number', required: true, min: 1 },
  config_type: { type: 'string', enum: ['wifi', 'wan', 'lan', 'voip', 'omci_raw', 'tr069', 'other'] },
  wifi_ssid: { type: 'string', max: 64 },
  wifi_password_encrypted: { type: 'string', max: 512 },
  wifi_band: { type: 'string', enum: ['2.4ghz', '5ghz', 'both'] },
  wifi_channel: { type: 'number', min: 1, max: 165 },
  wifi_security: { type: 'string', enum: ['open', 'wep', 'wpa2', 'wpa3'] },
  wan_mode: { type: 'string', enum: ['bridge', 'router', 'mixed'] },
  wan_ip_mode: { type: 'string', enum: ['dhcp', 'static', 'pppoe'] },
  wan_ip_address: { type: 'string', max: 45 },
  wan_netmask: { type: 'string', max: 45 },
  wan_gateway: { type: 'string', max: 45 },
  delivery_method: { type: 'string', enum: ['omci', 'tr069', 'ssh_cli', 'manual', 'pending'] },
  notes: { type: 'string', max: 1000 },
};

const updateOnuOmciConfig = {
  config_type: { type: 'string', enum: ['wifi', 'wan', 'lan', 'voip', 'omci_raw', 'tr069', 'other'] },
  wifi_ssid: { type: 'string', max: 64 },
  wifi_password_encrypted: { type: 'string', max: 512 },
  wifi_band: { type: 'string', enum: ['2.4ghz', '5ghz', 'both'] },
  wifi_channel: { type: 'number', min: 1, max: 165 },
  wifi_security: { type: 'string', enum: ['open', 'wep', 'wpa2', 'wpa3'] },
  wan_mode: { type: 'string', enum: ['bridge', 'router', 'mixed'] },
  wan_ip_mode: { type: 'string', enum: ['dhcp', 'static', 'pppoe'] },
  wan_ip_address: { type: 'string', max: 45 },
  wan_netmask: { type: 'string', max: 45 },
  wan_gateway: { type: 'string', max: 45 },
  delivery_method: { type: 'string', enum: ['omci', 'tr069', 'ssh_cli', 'manual', 'pending'] },
  apply_status: { type: 'string', enum: ['pending', 'in_progress', 'applied', 'failed', 'superseded'] },
  notes: { type: 'string', max: 1000 },
};

const patchOnuOmciConfig = Object.fromEntries(
  Object.entries(updateOnuOmciConfig).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOnuOmciConfig, updateOnuOmciConfig, patchOnuOmciConfig };
