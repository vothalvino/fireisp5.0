// =============================================================================
// FireISP 5.0 — Two-Factor Authentication (2FA/MFA) Service
// =============================================================================
// TOTP-based two-factor authentication using RFC 6238.
// Supports Google Authenticator, Authy, and similar TOTP apps.
// Includes backup codes for account recovery.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const { UnauthorizedError, ValidationError } = require('../utils/errors');

// TOTP parameters
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_ALGORITHM = 'sha1';
const BACKUP_CODE_COUNT = 10;
const TOTP_WINDOW = 1; // Allow ±1 time step for clock drift

/**
 * Generate a TOTP secret for a user. Does NOT enable 2FA yet.
 * Returns the secret and a provisioning URI for QR code generation.
 */
async function generateSecret(userId) {
  const [users] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
  if (users.length === 0) throw new ValidationError('User not found');

  const secret = crypto.randomBytes(20).toString('hex');
  const base32Secret = hexToBase32(secret);

  // Store the secret (not yet verified/enabled)
  await db.query(
    'UPDATE users SET totp_secret = ?, totp_enabled = FALSE WHERE id = ?',
    [secret, userId],
  );

  const issuer = 'FireISP';
  const account = users[0].email;
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;

  return {
    secret: base32Secret,
    uri,
    qr_data: uri,
  };
}

/**
 * Verify a TOTP code and enable 2FA for the user.
 * Must be called after generateSecret() to confirm the user has set up their authenticator.
 */
async function verifyAndEnable(userId, code) {
  const [users] = await db.query(
    'SELECT totp_secret FROM users WHERE id = ?',
    [userId],
  );
  if (users.length === 0 || !users[0].totp_secret) {
    throw new ValidationError('No 2FA secret configured. Call setup first.');
  }

  const valid = verifyTOTP(users[0].totp_secret, code);
  if (!valid) {
    throw new UnauthorizedError('Invalid verification code');
  }

  // Generate backup codes
  const backupCodes = generateBackupCodes();
  const hashedCodes = backupCodes.map(c =>
    crypto.createHash('sha256').update(c).digest('hex'),
  );

  await db.query(
    'UPDATE users SET totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?',
    [JSON.stringify(hashedCodes), userId],
  );

  return {
    enabled: true,
    backup_codes: backupCodes,
    message: 'Two-factor authentication enabled. Save your backup codes securely.',
  };
}

/**
 * Verify a TOTP code during login.
 */
async function verifyCode(userId, code) {
  const [users] = await db.query(
    'SELECT totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?',
    [userId],
  );
  if (users.length === 0) throw new UnauthorizedError('User not found');

  const user = users[0];
  if (!user.totp_enabled) {
    throw new ValidationError('2FA is not enabled for this account');
  }

  // Try TOTP first
  if (verifyTOTP(user.totp_secret, code)) {
    return { valid: true, method: 'totp' };
  }

  // Try backup code
  const backupCodes = JSON.parse(user.totp_backup_codes || '[]');
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const idx = backupCodes.indexOf(codeHash);

  if (idx !== -1) {
    // Remove used backup code
    backupCodes.splice(idx, 1);
    await db.query(
      'UPDATE users SET totp_backup_codes = ? WHERE id = ?',
      [JSON.stringify(backupCodes), userId],
    );
    return { valid: true, method: 'backup_code', remaining_codes: backupCodes.length };
  }

  throw new UnauthorizedError('Invalid 2FA code');
}

/**
 * Disable 2FA for a user.
 */
async function disable(userId) {
  await db.query(
    'UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?',
    [userId],
  );
  return { enabled: false, message: 'Two-factor authentication disabled' };
}

/**
 * Check if a user has 2FA enabled.
 */
async function getStatus(userId) {
  const [users] = await db.query(
    'SELECT totp_enabled FROM users WHERE id = ?',
    [userId],
  );
  return {
    enabled: !!(users[0]?.totp_enabled),
  };
}

/**
 * Regenerate backup codes for a user (requires valid 2FA code).
 */
async function regenerateBackupCodes(userId, code) {
  // Verify user has 2FA enabled and code is valid
  await verifyCode(userId, code);

  const backupCodes = generateBackupCodes();
  const hashedCodes = backupCodes.map(c =>
    crypto.createHash('sha256').update(c).digest('hex'),
  );

  await db.query(
    'UPDATE users SET totp_backup_codes = ? WHERE id = ?',
    [JSON.stringify(hashedCodes), userId],
  );

  return { backup_codes: backupCodes };
}

// ---------------------------------------------------------------------------
// TOTP Implementation (RFC 6238)
// ---------------------------------------------------------------------------

/**
 * Generate a TOTP value for the current time step.
 */
function generateTOTP(hexSecret, timeStep = null) {
  const time = timeStep ?? Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(time, 4);

  const hmac = crypto.createHmac(TOTP_ALGORITHM, Buffer.from(hexSecret, 'hex'));
  hmac.update(timeBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % (10 ** TOTP_DIGITS);
  return String(otp).padStart(TOTP_DIGITS, '0');
}

/**
 * Verify a TOTP code with a ±window tolerance for clock drift.
 */
function verifyTOTP(hexSecret, code) {
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD);

  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    const expected = generateTOTP(hexSecret, currentStep + i);
    if (timingSafeEqual(code, expected)) {
      return true;
    }
  }
  return false;
}

/**
 * Generate random backup codes.
 */
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

/**
 * Timing-safe string comparison.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (_err) {
    return false;
  }
}

/**
 * Convert hex to Base32 (RFC 4648) for QR code provisioning URIs.
 */
function hexToBase32(hex) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(hex, 'hex');
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += alphabet[parseInt(chunk, 2)];
  }
  return result;
}

module.exports = {
  generateSecret,
  verifyAndEnable,
  verifyCode,
  disable,
  getStatus,
  regenerateBackupCodes,
  generateTOTP,
  verifyTOTP,
  hexToBase32,
};
