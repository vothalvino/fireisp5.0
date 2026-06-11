// =============================================================================
// FireISP 5.0 — CPE Profile Service (§8.2)
// =============================================================================
'use strict';

const db = require('../config/database');
const CpeProfile = require('../models/CpeProfile');
const _CpeParameterMapping = require('../models/CpeParameterMapping');
const _logger = require('../utils/logger').child({ service: 'cpeProfileService' });

const MAX_INHERITANCE_DEPTH = 5;

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

/**
 * Load the full profile chain (up to MAX_INHERITANCE_DEPTH), return ordered
 * array from root (grandparent) to leaf (child).
 * @param {number} profileId
 * @returns {object[]} chain, index 0 = root, last = leaf
 */
async function resolveProfile(profileId) {
  const chain = [];
  let currentId = profileId;

  for (let depth = 0; depth < MAX_INHERITANCE_DEPTH; depth++) {
    const profile = await CpeProfile.findById(currentId);
    if (!profile) break;
    chain.unshift(profile); // prepend so root is first
    if (!profile.parent_profile_id) break;
    currentId = profile.parent_profile_id;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// mergeProfileParameters
// ---------------------------------------------------------------------------

/**
 * Merge the profile chain bottom-up: child values override parent values.
 * @param {object[]} profileChain - from resolveProfile (root first, leaf last)
 * @returns {{ wifi_ssid_template, wifi_security, wifi_channel, wifi_band, wan_mode, wan_vlan_id, parameters: {} }}
 */
function mergeProfileParameters(profileChain) {
  const merged = {
    wifi_ssid_template: null,
    wifi_security: null,
    wifi_channel: null,
    wifi_band: null,
    wan_mode: null,
    wan_vlan_id: null,
    parameters: {},
  };

  // Iterate root → leaf; later (child) values override earlier (parent) values
  for (const profile of profileChain) {
    if (profile.wifi_ssid_template) merged.wifi_ssid_template = profile.wifi_ssid_template;
    if (profile.wifi_security) merged.wifi_security = profile.wifi_security;
    if (profile.wifi_channel !== null && profile.wifi_channel !== undefined) merged.wifi_channel = profile.wifi_channel;
    if (profile.wifi_band) merged.wifi_band = profile.wifi_band;
    if (profile.wan_mode) merged.wan_mode = profile.wan_mode;
    if (profile.wan_vlan_id !== null && profile.wan_vlan_id !== undefined) merged.wan_vlan_id = profile.wan_vlan_id;

    // Merge parameters JSON (child keys override parent keys)
    if (profile.parameters) {
      const params = typeof profile.parameters === 'string'
        ? JSON.parse(profile.parameters)
        : profile.parameters;
      Object.assign(merged.parameters, params);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// buildProvisioningTasks
// ---------------------------------------------------------------------------

/**
 * Build cpe_tasks records to provision a CPE from a resolved profile.
 * @param {object} cpeDevice
 * @param {object[]} profileChain
 * @returns {object[]} array of partial cpe_tasks records (without id/org/cpe_device_id)
 */
async function buildProvisioningTasks(cpeDevice, profileChain) {
  if (!profileChain || profileChain.length === 0) return [];

  const merged = mergeProfileParameters(profileChain);
  const tasks = [];

  // Build SetParameterValues task from merged parameters
  const paramList = [];

  // Wi-Fi SSID from template
  if (merged.wifi_ssid_template) {
    const ssid = merged.wifi_ssid_template.replace('{{serial}}', cpeDevice.serial_number || '');
    paramList.push({ name: 'Device.WiFi.SSID.1.SSID', value: ssid, type: 'xsd:string' });
  }
  if (merged.wifi_security) {
    paramList.push({ name: 'Device.WiFi.AccessPoint.1.Security.ModeEnabled', value: merged.wifi_security, type: 'xsd:string' });
  }
  if (merged.wifi_band) {
    paramList.push({ name: 'Device.WiFi.Radio.1.OperatingFrequencyBand', value: merged.wifi_band, type: 'xsd:string' });
  }
  if (merged.wan_mode) {
    paramList.push({ name: 'Device.IP.Interface.1.IPv4Address.1.IPAddressingType', value: merged.wan_mode.toUpperCase(), type: 'xsd:string' });
  }
  if (merged.wan_vlan_id !== null && merged.wan_vlan_id !== undefined) {
    paramList.push({ name: 'Device.Ethernet.VLANTermination.1.VLANID', value: String(merged.wan_vlan_id), type: 'xsd:unsignedInt' });
  }

  // Parameters from the JSON map
  for (const [path, value] of Object.entries(merged.parameters)) {
    paramList.push({ name: path, value: String(value), type: 'xsd:string' });
  }

  if (paramList.length > 0) {
    tasks.push({
      task_type: 'set_parameter_values',
      parameters: paramList,
      status: 'queued',
      priority: 3,
    });
  }

  // Also queue a GetParameterValues to read back current state
  tasks.push({
    task_type: 'get_parameter_values',
    parameters: [
      'Device.DeviceInfo.SoftwareVersion',
      'Device.DeviceInfo.HardwareVersion',
      'Device.WiFi.SSID.1.SSID',
      'Device.WAN.IP',
    ],
    status: 'queued',
    priority: 8,
  });

  return tasks;
}

// ---------------------------------------------------------------------------
// resolveParameterMappings
// ---------------------------------------------------------------------------

/**
 * Evaluate parameter mappings for a profile against a contract/plan/device context.
 * @param {object} cpeDevice
 * @param {object|null} contract
 * @param {object|null} plan
 * @param {object|null} profile
 * @returns {Array<{path: string, value: string}>}
 */
async function resolveParameterMappings(cpeDevice, contract, plan, profile) {
  if (!profile) return [];

  const [mappings] = await db.query(
    'SELECT * FROM cpe_parameter_mappings WHERE cpe_profile_id = ?',
    [profile.id],
  );

  const result = [];
  for (const mapping of mappings) {
    let value = null;

    switch (mapping.source_type) {
      case 'static':
        value = mapping.static_value;
        break;
      case 'contract_field':
        if (contract && mapping.source_field) {
          value = String(contract[mapping.source_field] ?? '');
        }
        break;
      case 'plan_field':
        if (plan && mapping.source_field) {
          value = String(plan[mapping.source_field] ?? '');
        }
        break;
      case 'device_field':
        if (cpeDevice && mapping.source_field) {
          value = String(cpeDevice[mapping.source_field] ?? '');
        }
        break;
    }

    if (value !== null) {
      result.push({ path: mapping.parameter_path, value });
    }
  }

  return result;
}

module.exports = {
  resolveProfile,
  mergeProfileParameters,
  buildProvisioningTasks,
  resolveParameterMappings,
};
