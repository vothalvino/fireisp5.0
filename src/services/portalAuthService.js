// =============================================================================
// FireISP 5.0 — Portal Auth Service
// =============================================================================
// Handles authentication for the client self-service portal.
// Clients are NOT staff users — they authenticate with their email +
// a portal-specific password stored as a bcrypt hash on the clients table.
//
// JWT tokens issued here carry { sub: clientId, type: 'portal' } so they
// cannot be used against staff-only endpoints, and staff tokens cannot be
// used against portal endpoints.
// =============================================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const { UnauthorizedError, ValidationError } = require('../utils/errors');

const SALT_ROUNDS = 12;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ACCESS_SECONDS = 900;    // 15 minutes
const REFRESH_SECONDS = 604800; // 7 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// login — validate email + password, return tokens
// ---------------------------------------------------------------------------

async function login({ email, password }) {
  if (!email || !password) {
    throw new ValidationError('email and password are required');
  }

  const [rows] = await db.query(
    `SELECT id, organization_id, name, email, status,
            portal_password_hash, portal_login_attempts, portal_locked_until
     FROM clients
     WHERE email = ? AND deleted_at IS NULL
     LIMIT 1`,
    [email.toLowerCase().trim()],
  );

  const client = rows[0];

  // Generic error to avoid email enumeration
  const invalidCreds = () => new UnauthorizedError('Invalid email or password');

  if (!client) throw invalidCreds();

  if (client.status === 'inactive') {
    throw new UnauthorizedError('Account is not active');
  }

  if (!client.portal_password_hash) {
    throw new UnauthorizedError('Portal access is not enabled for this account');
  }

  // Lockout check
  if (client.portal_locked_until && new Date(client.portal_locked_until) > new Date()) {
    throw new UnauthorizedError('Account temporarily locked. Please try again later');
  }

  const valid = await bcrypt.compare(password, client.portal_password_hash);

  if (!valid) {
    const attempts = (client.portal_login_attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      await db.query(
        'UPDATE clients SET portal_login_attempts = ?, portal_locked_until = ? WHERE id = ?',
        [attempts, lockedUntil, client.id],
      );
      throw new UnauthorizedError('Account temporarily locked due to too many failed attempts');
    }
    await db.query(
      'UPDATE clients SET portal_login_attempts = ? WHERE id = ?',
      [attempts, client.id],
    );
    throw invalidCreds();
  }

  // Reset lockout on success
  await db.query(
    'UPDATE clients SET portal_login_attempts = 0, portal_locked_until = NULL WHERE id = ?',
    [client.id],
  );

  // Issue tokens
  const accessToken = jwt.sign(
    { sub: client.id, orgId: client.organization_id, type: 'portal' },
    config.jwt.secret,
    { expiresIn: ACCESS_SECONDS, algorithm: config.jwt.algorithm },
  );

  const refreshToken = generateRefreshToken();
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000);

  await db.query(
    `INSERT INTO portal_refresh_tokens (client_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [client.id, tokenHash, expiresAt],
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_SECONDS,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      organization_id: client.organization_id,
    },
  };
}

// ---------------------------------------------------------------------------
// refreshToken — exchange a refresh token for a new access token
// ---------------------------------------------------------------------------

async function refreshToken(token) {
  if (!token) throw new UnauthorizedError('Refresh token required');

  const hash = crypto.createHash('sha256').update(token).digest('hex');

  const [rows] = await db.query(
    `SELECT prt.*, c.id AS client_id, c.organization_id, c.name, c.email, c.status
     FROM portal_refresh_tokens prt
     JOIN clients c ON c.id = prt.client_id
     WHERE prt.token_hash = ?
       AND prt.revoked_at IS NULL
       AND prt.expires_at > NOW()
       AND c.deleted_at IS NULL
     LIMIT 1`,
    [hash],
  );

  if (rows.length === 0) throw new UnauthorizedError('Invalid or expired refresh token');

  const row = rows[0];

  if (row.status === 'inactive') {
    throw new UnauthorizedError('Account is not active');
  }

  // Rotate: revoke old, issue new
  await db.query(
    'UPDATE portal_refresh_tokens SET revoked_at = NOW() WHERE id = ?',
    [row.id],
  );

  const newAccessToken = jwt.sign(
    { sub: row.client_id, orgId: row.organization_id, type: 'portal' },
    config.jwt.secret,
    { expiresIn: ACCESS_SECONDS, algorithm: config.jwt.algorithm },
  );

  const newRefreshToken = generateRefreshToken();
  const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000);

  await db.query(
    'INSERT INTO portal_refresh_tokens (client_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [row.client_id, newHash, expiresAt],
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// logout — revoke a refresh token
// ---------------------------------------------------------------------------

async function logout(token) {
  if (!token) return;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(
    'UPDATE portal_refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?',
    [hash],
  );
}

// ---------------------------------------------------------------------------
// setPassword — (re-)set the portal password for a client (admin action)
// ---------------------------------------------------------------------------

async function setPassword(clientId, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new ValidationError('Portal password must be at least 8 characters');
  }
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.query(
    'UPDATE clients SET portal_password_hash = ?, portal_login_attempts = 0, portal_locked_until = NULL WHERE id = ?',
    [hash, clientId],
  );
}

module.exports = { login, refreshToken, logout, setPassword };
