// =============================================================================
// FireISP 5.0 — Auth Service
// =============================================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const db = require('../config/database');
const { UnauthorizedError, ConflictError, ValidationError } = require('../utils/errors');

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
  const crypto = require('crypto');
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
  const crypto = require('crypto');
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(
    'DELETE FROM user_sessions WHERE token_hash = ?',
    [sessionHash],
  );
}

module.exports = { register, login, logout };
