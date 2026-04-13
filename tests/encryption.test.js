// =============================================================================
// FireISP 5.0 — Encryption Utility Tests
// =============================================================================

describe('encryption utility', () => {
  const VALID_KEY = 'a'.repeat(64);
  let encryption;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  test('encrypt/decrypt round-trips correctly', () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    encryption = require('../src/utils/encryption');

    const plaintext = 'my-secret-api-key-12345';
    const encrypted = encryption.encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(':'); // format: iv:tag:ciphertext

    const decrypted = encryption.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test('different calls produce different ciphertexts (unique IV)', () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    encryption = require('../src/utils/encryption');

    const plaintext = 'same-value';
    const a = encryption.encrypt(plaintext);
    const b = encryption.encrypt(plaintext);

    expect(a).not.toBe(b); // random IV each time
    expect(encryption.decrypt(a)).toBe(plaintext);
    expect(encryption.decrypt(b)).toBe(plaintext);
  });

  test('returns plaintext when ENCRYPTION_KEY is not set', () => {
    encryption = require('../src/utils/encryption');

    const plaintext = 'plaintext-secret';
    expect(encryption.encrypt(plaintext)).toBe(plaintext);
    expect(encryption.decrypt(plaintext)).toBe(plaintext);
  });

  test('handles null and undefined gracefully', () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    encryption = require('../src/utils/encryption');

    expect(encryption.encrypt(null)).toBeNull();
    expect(encryption.encrypt(undefined)).toBeUndefined();
    expect(encryption.decrypt(null)).toBeNull();
    expect(encryption.decrypt(undefined)).toBeUndefined();
  });

  test('decrypt returns legacy plaintext when value has no colon format', () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    encryption = require('../src/utils/encryption');

    expect(encryption.decrypt('legacy-plain-value')).toBe('legacy-plain-value');
  });

  test('decrypt returns ciphertext as-is when decryption fails (tampered)', () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    encryption = require('../src/utils/encryption');

    const encrypted = encryption.encrypt('test');
    const tampered = encrypted.replace(/.$/, 'X');
    // Should not throw — returns the tampered string as-is
    const result = encryption.decrypt(tampered);
    expect(typeof result).toBe('string');
  });

  test('throws when ENCRYPTION_KEY is wrong length', () => {
    process.env.ENCRYPTION_KEY = 'too-short';
    encryption = require('../src/utils/encryption');

    expect(() => encryption.encrypt('test')).toThrow('64-character hex string');
  });

  test('getKey returns null when ENCRYPTION_KEY not set', () => {
    encryption = require('../src/utils/encryption');
    expect(encryption.getKey()).toBeNull();
  });

  test('getKey returns Buffer when ENCRYPTION_KEY is valid', () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    encryption = require('../src/utils/encryption');
    const key = encryption.getKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32); // 256 bits
  });
});
