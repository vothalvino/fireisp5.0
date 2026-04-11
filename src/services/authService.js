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

  // Strip password_hash from return
  const { password_hash: _ph, ...safeUser } = user;
  return safeUser;
}

/**
 * Authenticate a user and return a JWT token.
 */
async function login({ email, password }) {
  const user = await User.findByEmail(email);
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.status !== 'active') {
    throw new UnauthorizedError('Account is inactive');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Update last_login_at
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  // Get user's primary organization
  const orgs = await User.getOrganizations(user.id);
  const primaryOrg = orgs[0] || null;

  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: primaryOrg?.id || user.organization_id,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );

  // Record session
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [user.id, sessionHash, null, null],
  );

  const { password_hash: _ph, ...safeUser } = user;
  return {
    token,
    user: safeUser,
    organizations: orgs,
  };
}

/**
 * Invalidate a session (logout).
 */
async function logout(token) {
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
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
  register, login, logout,
  requestPasswordReset, resetPassword, changePassword,
  verifyEmail, generateEmailVerificationToken,
};
