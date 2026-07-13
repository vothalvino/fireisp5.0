// =============================================================================
// FireISP 5.0 — Device row sanitizer
// =============================================================================
// Strips the encrypted SNMPv3 auth/priv passphrase columns from a `devices`
// record before it is returned by any endpoint. Both columns hold ciphertext
// at rest — but src/utils/encryption.js's encrypt()/decrypt() are transparent
// no-ops when ENCRYPTION_KEY is unset (dev/test/misconfigured prod), in which
// case they hold PLAINTEXT passphrases. The UI only needs to know whether a
// key is configured, not its value, so a boolean is substituted for each.
// Lives in its own module (rather than only inline in src/routes/devices.js)
// so src/routes/discoveryScans.js's onboard-from-discovery endpoint — which
// creates a Device via the model directly, bypassing devices.js's
// crudController — can reuse the exact same redaction. Mirrors
// src/utils/radiusSanitize.js.
// =============================================================================

/**
 * Return a shallow copy of a devices row with the encrypted SNMPv3 columns
 * replaced by `has_snmp_v3_auth_key` / `has_snmp_v3_priv_key` booleans.
 * Non-object inputs (null/undefined) are returned unchanged.
 *
 * @param {object|null|undefined} row
 * @returns {object|null|undefined}
 */
function redactDevice(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  const hasAuthKey = Boolean(rest.snmp_v3_auth_key_encrypted);
  const hasPrivKey = Boolean(rest.snmp_v3_priv_key_encrypted);
  delete rest.snmp_v3_auth_key_encrypted;
  delete rest.snmp_v3_priv_key_encrypted;
  return { ...rest, has_snmp_v3_auth_key: hasAuthKey, has_snmp_v3_priv_key: hasPrivKey };
}

module.exports = { redactDevice };
