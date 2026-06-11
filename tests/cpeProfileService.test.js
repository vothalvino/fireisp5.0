// =============================================================================
// FireISP 5.0 — CPE Profile Service Tests (inheritance merge)
// =============================================================================
'use strict';

// Mock database and CpeProfile model so we can test pure merge logic
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/models/CpeProfile', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/models/CpeParameterMapping', () => ({}));

const db = require('../src/config/database');
const CpeProfile = require('../src/models/CpeProfile');
const cpeProfileService = require('../src/services/cpeProfileService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('mergeProfileParameters', () => {
  test('base profile only (no parent)', () => {
    const chain = [
      {
        id: 1,
        parent_profile_id: null,
        wifi_ssid_template: 'Base-{{serial}}',
        wifi_security: 'WPA2-PSK',
        wifi_channel: 6,
        wifi_band: '2.4GHz',
        wan_mode: 'pppoe',
        wan_vlan_id: null,
        parameters: JSON.stringify({ 'Device.Info.1': 'base-value' }),
      },
    ];
    const merged = cpeProfileService.mergeProfileParameters(chain);
    expect(merged.wifi_ssid_template).toBe('Base-{{serial}}');
    expect(merged.wifi_security).toBe('WPA2-PSK');
    expect(merged.wifi_band).toBe('2.4GHz');
    expect(merged.wan_mode).toBe('pppoe');
    expect(merged.parameters['Device.Info.1']).toBe('base-value');
  });

  test('child overrides parent field (wifi_ssid_template)', () => {
    const chain = [
      {
        id: 1,
        parent_profile_id: null,
        wifi_ssid_template: 'Parent-SSID',
        wifi_security: 'WPA2-PSK',
        wifi_channel: 6,
        wifi_band: '2.4GHz',
        wan_mode: 'pppoe',
        wan_vlan_id: null,
        parameters: null,
      },
      {
        id: 2,
        parent_profile_id: 1,
        wifi_ssid_template: 'Child-{{serial}}',
        wifi_security: null,
        wifi_channel: null,
        wifi_band: null,
        wan_mode: null,
        wan_vlan_id: null,
        parameters: null,
      },
    ];
    const merged = cpeProfileService.mergeProfileParameters(chain);
    // Child value wins for wifi_ssid_template
    expect(merged.wifi_ssid_template).toBe('Child-{{serial}}');
    // Parent value retained for inherited fields
    expect(merged.wifi_security).toBe('WPA2-PSK');
    expect(merged.wifi_band).toBe('2.4GHz');
  });

  test('3-level chain: grandparent → parent → child', () => {
    const chain = [
      {
        id: 1,
        parent_profile_id: null,
        wifi_ssid_template: 'GP-SSID',
        wifi_security: 'WPA2-PSK',
        wifi_channel: 1,
        wifi_band: '2.4GHz',
        wan_mode: 'dhcp',
        wan_vlan_id: null,
        parameters: JSON.stringify({ 'A': 'gp', 'B': 'gp-b' }),
      },
      {
        id: 2,
        parent_profile_id: 1,
        wifi_ssid_template: 'P-SSID',
        wifi_security: null,
        wifi_channel: 6,
        wifi_band: null,
        wan_mode: 'pppoe',
        wan_vlan_id: 100,
        parameters: JSON.stringify({ 'A': 'parent', 'C': 'parent-c' }),
      },
      {
        id: 3,
        parent_profile_id: 2,
        wifi_ssid_template: null,
        wifi_security: 'WPA3-SAE',
        wifi_channel: null,
        wifi_band: '5GHz',
        wan_mode: null,
        wan_vlan_id: null,
        parameters: JSON.stringify({ 'B': 'child-b' }),
      },
    ];
    const merged = cpeProfileService.mergeProfileParameters(chain);
    // wifi_ssid_template: gp -> parent -> child (child is null so parent wins)
    expect(merged.wifi_ssid_template).toBe('P-SSID');
    // wifi_security: gp=WPA2-PSK, parent=null, child=WPA3-SAE → child wins
    expect(merged.wifi_security).toBe('WPA3-SAE');
    // wifi_channel: gp=1, parent=6, child=null → parent wins
    expect(merged.wifi_channel).toBe(6);
    // wifi_band: gp=2.4GHz, parent=null, child=5GHz → child wins
    expect(merged.wifi_band).toBe('5GHz');
    // wan_mode: gp=dhcp, parent=pppoe, child=null → parent wins
    expect(merged.wan_mode).toBe('pppoe');
    // wan_vlan_id: gp=null, parent=100, child=null → parent wins
    expect(merged.wan_vlan_id).toBe(100);
    // parameters merge: A=parent (child override of gp), B=child-b (child override of gp), C=parent-c (parent only)
    expect(merged.parameters['A']).toBe('parent');
    expect(merged.parameters['B']).toBe('child-b');
    expect(merged.parameters['C']).toBe('parent-c');
  });

  test('parameters JSON merge: child overrides individual keys, parent keys not in child are preserved', () => {
    const chain = [
      {
        id: 1,
        parent_profile_id: null,
        wifi_ssid_template: null,
        wifi_security: null,
        wifi_channel: null,
        wifi_band: null,
        wan_mode: null,
        wan_vlan_id: null,
        parameters: JSON.stringify({ 'key1': 'parent1', 'key2': 'parent2', 'key3': 'parent3' }),
      },
      {
        id: 2,
        parent_profile_id: 1,
        wifi_ssid_template: null,
        wifi_security: null,
        wifi_channel: null,
        wifi_band: null,
        wan_mode: null,
        wan_vlan_id: null,
        parameters: JSON.stringify({ 'key2': 'child2', 'key4': 'child4' }),
      },
    ];
    const merged = cpeProfileService.mergeProfileParameters(chain);
    expect(merged.parameters['key1']).toBe('parent1'); // parent only → preserved
    expect(merged.parameters['key2']).toBe('child2');  // child overrides parent
    expect(merged.parameters['key3']).toBe('parent3'); // parent only → preserved
    expect(merged.parameters['key4']).toBe('child4');  // child only → added
  });
});

describe('resolveProfile', () => {
  test('resolves a single profile with no parent', async () => {
    const profile = {
      id: 1,
      parent_profile_id: null,
      wifi_ssid_template: 'Test',
    };
    CpeProfile.findById.mockResolvedValue(profile);

    const chain = await cpeProfileService.resolveProfile(1);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe(1);
  });

  test('resolves a 2-level chain (parent → child)', async () => {
    const parent = { id: 10, parent_profile_id: null, wifi_ssid_template: 'Parent' };
    const child = { id: 20, parent_profile_id: 10, wifi_ssid_template: 'Child' };

    CpeProfile.findById
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(parent);

    const chain = await cpeProfileService.resolveProfile(20);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(10); // root first
    expect(chain[1].id).toBe(20); // leaf last
  });
});
