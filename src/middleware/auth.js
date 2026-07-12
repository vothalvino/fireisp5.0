// =============================================================================
// FireISP 5.0 — Authentication Middleware
// =============================================================================
// Validates JWT tokens and API tokens, attaching the authenticated user to
// req.user. Supports both Bearer JWT tokens and API key tokens.
// =============================================================================

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const User = require('../models/User');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Authenticate via API token (X-API-Key header).
 * Validates the token exists, is not revoked, and is not expired.
 */
async function authenticateApiToken(req) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return false;

  // SHA-256 is appropriate for API token hashing (unlike passwords, tokens have
  // sufficient entropy). This is the industry-standard approach used by GitHub,
  // AWS, Stripe, etc.  Using bcrypt/scrypt here would add latency to every
  // authenticated request without meaningful security benefit.
  const tokenHash = crypto.createHash('sha256').update(apiKey).digest('hex'); // lgtm[js/insufficient-password-hash]

  const [rows] = await db.query(
    `SELECT at.*, u.email, u.role, u.status, u.organization_id
     FROM api_tokens at
     JOIN users u ON u.id = at.user_id AND u.deleted_at IS NULL
     WHERE at.token_hash = ?
       AND at.revoked_at IS NULL
       AND (at.expires_at IS NULL OR at.expires_at > NOW())`,
    [tokenHash],
  );

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid or expired API token');
  }

  const token = rows[0];

  if (token.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Update last_used tracking
  await db.query(
    'UPDATE api_tokens SET last_used_at = NOW(), last_used_ip = ? WHERE id = ?',
    [req.ip || null, token.id],
  );

  req.user = {
    id: token.user_id,
    email: token.email,
    role: token.role,
    organizationId: token.organization_id,
    apiTokenId: token.id,
    scopes: token.scopes || null,
  };

  return true;
}

/**
 * Require authentication. Attaches req.user with id, email, role, orgId, etc.
 * Supports both Bearer JWT tokens and X-API-Key header.
 * For the browser SPA, also accepts the JWT from the `fireisp_access` httpOnly cookie.
 */
async function authenticate(req, _res, next) {
  try {
    // Try API key first
    const apiKeyAuth = await authenticateApiToken(req);
    if (apiKeyAuth) return next();

    // Determine JWT source: Authorization header takes precedence over cookie
    // so that programmatic API clients (tests, scripts) continue to work
    // unchanged.  The browser SPA falls back to the httpOnly cookie when no
    // Bearer header is present.
    let token;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (req.cookies?.fireisp_access) {
      token = req.cookies.fireisp_access;
    } else {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, { algorithms: [config.jwt.algorithm] });
    } catch (_err) {
      throw new UnauthorizedError('Invalid or expired token');
    }

    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('User not found or inactive');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: payload.orgId || user.organization_id,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth — doesn't fail if no token is present.
 * Delegates to authenticate when a Bearer header, API key, or httpOnly access
 * cookie is present so that cookie-authenticated SPA users are recognized.
 */
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];
  const hasCookie = !!req.cookies?.fireisp_access;
  if (!apiKey && (!header || !header.startsWith('Bearer ')) && !hasCookie) {
    return next();
  }
  return authenticate(req, _res, next);
}

module.exports = { authenticate, optionalAuth };
