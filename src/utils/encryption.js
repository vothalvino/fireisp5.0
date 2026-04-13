// =============================================================================
// FireISP 5.0 — AES-256-GCM Envelope Encryption
// =============================================================================
// Encrypts / decrypts sensitive data (payment gateway secrets, PAC passwords,
// CSD private keys, webhook secrets) at the application layer.
//
// Requires ENCRYPTION_KEY env var — a 64-character hex string (256 bits).
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// =============================================================================

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;     // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;    // 128-bit auth tag
const ENCODING = 'hex';

/**
 * Derive the 256-bit encryption key from the ENCRYPTION_KEY env var.
 * Returns null when the env var is not set (encryption disabled).
 */
function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (256 bits)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string.
 *
 * Output format: hex(iv) + ':' + hex(authTag) + ':' + hex(ciphertext)
 *
 * When ENCRYPTION_KEY is not configured the plaintext is returned as-is
 * so that development / test environments work without encryption.
 *
 * @param {string} plaintext
 * @returns {string}
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;

  const key = getKey();
  if (!key) return plaintext; // encryption disabled

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return `${iv.toString(ENCODING)}:${tag.toString(ENCODING)}:${encrypted.toString(ENCODING)}`;
}

/**
 * Decrypt an encrypted string produced by `encrypt()`.
 *
 * When ENCRYPTION_KEY is not configured the ciphertext is returned as-is
 * (assumed to be plaintext in non-encrypted environments).
 *
 * @param {string} ciphertext
 * @returns {string}
 */
function decrypt(ciphertext) {
  if (ciphertext === null || ciphertext === undefined) return ciphertext;

  const key = getKey();
  if (!key) return ciphertext; // encryption disabled

  // If the value doesn't look like our format, return as-is (legacy plaintext)
  const parts = String(ciphertext).split(':');
  if (parts.length !== 3) return ciphertext;

  const [ivHex, tagHex, encHex] = parts;

  try {
    const iv = Buffer.from(ivHex, ENCODING);
    const tag = Buffer.from(tagHex, ENCODING);
    const encrypted = Buffer.from(encHex, ENCODING);

    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) return ciphertext;

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (_err) {
    // If decryption fails the value may be legacy plaintext — return as-is
    return ciphertext;
  }
}

module.exports = { encrypt, decrypt, getKey };
