// =============================================================================
// FireISP 5.0 — Device row sanitizer unit tests
// =============================================================================
// Both src/routes/devices.js (crudController's `serialize` option) and
// src/routes/discoveryScans.js (the onboard-from-discovery endpoint, which
// creates a Device via the model directly, bypassing devices.js entirely)
// depend on this shared helper to strip the encrypted SNMPv3 auth/priv
// passphrase columns from every response.
// =============================================================================

const { redactDevice } = require('../src/utils/deviceSanitize');

describe('redactDevice', () => {
  test('strips snmp_v3_auth_key_encrypted and snmp_v3_priv_key_encrypted', () => {
    const row = {
      id: 1,
      name: 'core-switch',
      snmp_v3_auth_key_encrypted: 'PLAINTEXT_AUTH_KEY',
      snmp_v3_priv_key_encrypted: 'PLAINTEXT_PRIV_KEY',
    };

    const result = redactDevice(row);

    expect(result).not.toHaveProperty('snmp_v3_auth_key_encrypted');
    expect(result).not.toHaveProperty('snmp_v3_priv_key_encrypted');
    expect(JSON.stringify(result)).not.toContain('PLAINTEXT');
  });

  test('substitutes has_snmp_v3_auth_key / has_snmp_v3_priv_key booleans', () => {
    const configured = redactDevice({
      id: 1,
      snmp_v3_auth_key_encrypted: 'key',
      snmp_v3_priv_key_encrypted: 'key',
    });
    expect(configured.has_snmp_v3_auth_key).toBe(true);
    expect(configured.has_snmp_v3_priv_key).toBe(true);

    const unconfigured = redactDevice({
      id: 2,
      snmp_v3_auth_key_encrypted: null,
      snmp_v3_priv_key_encrypted: null,
    });
    expect(unconfigured.has_snmp_v3_auth_key).toBe(false);
    expect(unconfigured.has_snmp_v3_priv_key).toBe(false);
  });

  test('leaves non-secret fields untouched', () => {
    const result = redactDevice({
      id: 1,
      name: 'core-switch',
      ip_address: '10.0.0.1',
      status: 'active',
    });
    expect(result).toMatchObject({
      id: 1,
      name: 'core-switch',
      ip_address: '10.0.0.1',
      status: 'active',
    });
  });

  test('passes through non-object input unchanged (null/undefined)', () => {
    expect(redactDevice(null)).toBeNull();
    expect(redactDevice(undefined)).toBeUndefined();
  });
});
