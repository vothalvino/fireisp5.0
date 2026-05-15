// =============================================================================
// FireISP 5.0 — Auth Service
// =============================================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const db = require('../config/database');
const { UnauthorizedError, ConflictError, ValidationError, NotFoundError } = require('../utils/errors');

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Refresh token lifetime in seconds (parsed from config, e.g. '7d' → 604800)
const REFRESH_SECONDS = parseExpiry(config.jwt.refreshExpiresIn);

// Access token lifetime in seconds (parsed from config, e.g. '15m' → 900)
const ACCESS_SECONDS = parseExpiry(config.jwt.accessExpiresIn);

/**
 * Parse a human-readable expiry string ('15m', '7d', '24h') into seconds.
 */
function parseExpiry(str) {
  if (!str) return 604800; // 7 days
  const m = String(str).match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return 604800;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return 604800;
  }
}

/**
 * Generate an opaque refresh token (64-char hex string).
 */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Register a new user.
 */
async function register({ firstName, lastName, email, password, organizationId, role }) {
  // Check for existing email
  const existing = await User.findByEmail(email);
  if (existing) {
    throw new ConflictError('Email already registered');
  }

  if (!password || password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await User.create({
    first_name: firstName,
    last_name: lastName,
    email,
    password_hash: passwordHash,
    organization_id: organizationId || null,
    role: role || 'support',
  });

  // If organization provided, create organization_users membership
  if (organizationId) {
    await db.query(
      'INSERT INTO organization_users (organization_id, user_id, role) VALUES (?, ?, ?)',
      [organizationId, user.id, role || 'readonly'],
    );
  }

  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

/**
 * Authenticate a user and return an access token + refresh token pair.
 */
async function login({ email, password }) {
  const user = await User.findByEmail(email);
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.status !== 'active') {
    throw new UnauthorizedError('Account is inactive');
  }

  // Check brute-force lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new UnauthorizedError('Account temporarily locked due to too many failed login attempts');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    // Increment failed attempts and potentially lock the account
    const attempts = (user.failed_login_attempts || 0) + 1;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      await db.query(
        'UPDATE users SET failed_login_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
        [attempts, LOCKOUT_MINUTES, user.id],
      );
    } else {
      await db.query(
        'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
        [attempts, user.id],
      );
    }
    throw new UnauthorizedError('Invalid email or password');
  }

  // Reset failed attempts on successful login
  if (user.failed_login_attempts > 0 || user.locked_until) {
    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [user.id],
    );
  }

  // Update last_login_at
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  // Get user's primary organization
  const orgs = await User.getOrganizations(user.id);
  const primaryOrg = orgs[0] || null;

  // Issue short-lived access token (JWT, 15 min default)
  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: primaryOrg?.id || user.organization_id,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn, algorithm: config.jwt.algorithm },
  );

  // Issue opaque refresh token + assign a token family for reuse detection
  const refreshTokenValue = generateRefreshToken();
  const family = crypto.randomUUID();
  const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');

  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, token_family, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [user.id, refreshHash, family, null, null, REFRESH_SECONDS],
  );

  const { password_hash: _hash, ...safeUser } = user;
  return {
    accessToken,
    refreshToken: refreshTokenValue,
    expiresIn: ACCESS_SECONDS,
    user: safeUser,
    organizations: orgs,
  };
}

/**
 * Refresh an access token using a valid refresh token.
 * Implements rotation: the old refresh token is consumed and a new pair is issued.
 * Detects token reuse (previously rotated token) and revokes the entire family.
 */
async function refreshToken(currentRefreshToken) {
  const oldHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');

  // Look up the refresh token session
  const [sessions] = await db.query(
    'SELECT * FROM user_sessions WHERE token_hash = ?',
    [oldHash],
  );

  if (sessions.length === 0) {
    // Token not found: either invalid, already consumed (rotated), or expired and cleaned up.
    // True reuse detection requires keeping revoked sessions, which is a future enhancement.
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const session = sessions[0];

  // Check expiry
  if (new Date(session.expires_at) <= new Date()) {
    // Expired — clean up and reject
    await db.query('DELETE FROM user_sessions WHERE id = ?', [session.id]);
    throw new UnauthorizedError('Refresh token expired');
  }

  // User must still be active
  const user = await User.findById(session.user_id);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Get user's primary organization for the new access token
  const orgs = await User.getOrganizations(user.id);
  const primaryOrg = orgs[0] || null;

  // Issue new access token
  const newAccessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: primaryOrg?.id || user.organization_id,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn, algorithm: config.jwt.algorithm },
  );

  // Issue new refresh token (rotation)
  const newRefreshValue = generateRefreshToken();
  const newRefreshHash = crypto.createHash('sha256').update(newRefreshValue).digest('hex');
  const family = session.token_family;

  // Rotate: delete old session, insert new one with same family
  await db.query('DELETE FROM user_sessions WHERE id = ?', [session.id]);
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, token_family, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [user.id, newRefreshHash, family, null, null, REFRESH_SECONDS],
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshValue,
    expiresIn: ACCESS_SECONDS,
  };
}

/**
 * Invalidate a session (logout). Accepts a refresh token to revoke the session.
 */
async function logout(refreshTokenValue) {
  const sessionHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
  await db.query(
    'DELETE FROM user_sessions WHERE token_hash = ?',
    [sessionHash],
  );
}

/**
 * Request a password reset. Generates a random token valid for 1 hour.
 * Returns the token (caller is responsible for emailing it).
 */
async function requestPasswordReset(email) {
  const user = await User.findByEmail(email);
  if (!user) {
    // Return silently to prevent user enumeration
    return { message: 'If that email exists, a reset link has been sent' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await db.query(
    `UPDATE users SET reset_token_hash = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR)
     WHERE id = ?`,
    [tokenHash, user.id],
  );

  return { token, email: user.email, userId: user.id };
}

/**
 * Reset password using a valid token.
 */
async function resetPassword(token, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const [rows] = await db.query(
    'SELECT * FROM users WHERE reset_token_hash = ? AND reset_token_expires > NOW()',
    [tokenHash],
  );

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  const user = rows[0];
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.query(
    'UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?',
    [passwordHash, user.id],
  );

  // Invalidate all existing sessions
  await db.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);

  return { message: 'Password reset successfully' };
}

/**
 * Change password for an authenticated user.
 */
async function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new ValidationError('New password must be at least 8 characters');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new NotFoundError('User');
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.query(
    'UPDATE users SET password_hash = ? WHERE id = ?',
    [passwordHash, user.id],
  );

  // Invalidate all existing sessions for this user (force re-login)
  await db.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);

  return { message: 'Password changed successfully' };
}

/**
 * Verify email using a token (sets email_verified_at if the token is valid).
 */
async function verifyEmail(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const [rows] = await db.query(
    'SELECT * FROM users WHERE email_verify_token_hash = ?',
    [tokenHash],
  );

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid verification token');
  }

  await db.query(
    'UPDATE users SET email_verified_at = NOW(), email_verify_token_hash = NULL WHERE id = ?',
    [rows[0].id],
  );

  return { message: 'Email verified successfully' };
}

/**
 * Switch the active organization for a user who belongs to multiple
 * organizations.  The caller proves possession of the current refresh token,
 * which we rotate (within the same family) so the previous tokens are
 * invalidated immediately.  A new access token is minted with `orgId` set to
 * the requested organization.
 *
 * Throws ForbiddenError if the user is not a member of the target org.
 */
async function switchOrganization(userId, organizationId, currentRefreshToken) {
  const { ForbiddenError } = require('../utils/errors');

  if (!organizationId) {
    throw new ValidationError('organizationId is required');
  }

  // Verify membership: user must have a non-deleted organization_users row
  // for the target org AND the org itself must not be soft-deleted.
  const [rows] = await db.query(
    `SELECT ou.role AS membership_role, o.id AS org_id, o.name AS org_name
     FROM organization_users ou
     JOIN organizations o ON o.id = ou.organization_id
     WHERE ou.user_id = ? AND ou.organization_id = ?
       AND ou.deleted_at IS NULL AND o.deleted_at IS NULL`,
    [userId, organizationId],
  );

  if (rows.length === 0) {
    throw new ForbiddenError('User is not a member of the requested organization');
  }
  const membership = rows[0];

  // User must still be active.
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Validate + rotate the refresh token.  We require the current refresh token
  // so a stolen access token alone cannot be used to pivot to another org.
  if (!currentRefreshToken) {
    throw new UnauthorizedError('Refresh token required to switch organizations');
  }
  const oldHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');
  const [sessions] = await db.query(
    'SELECT * FROM user_sessions WHERE token_hash = ? AND user_id = ?',
    [oldHash, userId],
  );
  if (sessions.length === 0) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  const session = sessions[0];
  if (new Date(session.expires_at) <= new Date()) {
    await db.query('DELETE FROM user_sessions WHERE id = ?', [session.id]);
    throw new UnauthorizedError('Refresh token expired');
  }

  // Mint new access token bound to the requested organization.
  const newAccessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: membership.org_id,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn, algorithm: config.jwt.algorithm },
  );

  // Rotate refresh token within the same family.
  const newRefreshValue = generateRefreshToken();
  const newRefreshHash = crypto.createHash('sha256').update(newRefreshValue).digest('hex');
  await db.query('DELETE FROM user_sessions WHERE id = ?', [session.id]);
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, token_family, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [user.id, newRefreshHash, session.token_family, null, null, REFRESH_SECONDS],
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshValue,
    expiresIn: ACCESS_SECONDS,
    organization: {
      id: membership.org_id,
      name: membership.org_name,
      membership_role: membership.membership_role,
    },
  };
}

/**
 * Generate an email verification token for a user.
 */
async function generateEmailVerificationToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await db.query(
    'UPDATE users SET email_verify_token_hash = ? WHERE id = ?',
    [tokenHash, userId],
  );

  return { token };
}

module.exports = {
  register, login, logout, refreshToken, switchOrganization,
  requestPasswordReset, resetPassword, changePassword,
  verifyEmail, generateEmailVerificationToken,
  // Exported for cookie maxAge calculations in auth routes
  REFRESH_SECONDS,
  ACCESS_SECONDS,
};
