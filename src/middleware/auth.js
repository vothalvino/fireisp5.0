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
const { resolveOrgPrincipal } = require('../services/orgPrincipalService');
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

  const [rows] = await db.withPrimaryContext(() => db.query(
    `SELECT at.id, at.user_id, at.organization_id AS token_organization_id,
            at.scopes, (at.scopes IS NULL) AS scopes_sql_null,
            at.expires_at, at.revoked_at, at.last_used_at, at.last_used_ip,
            akrl.id AS rate_limit_policy_id,
            akrl.requests_per_minute, akrl.requests_per_hour,
            akrl.requests_per_day, akrl.burst_size,
            akrl.is_active AS rate_limit_policy_active,
            u.email, u.role, u.status,
            u.organization_id AS user_home_organization_id,
            u.is_install_operator
       FROM api_tokens at
       JOIN users u ON u.id = at.user_id AND u.deleted_at IS NULL
       LEFT JOIN api_key_rate_limits akrl
         ON akrl.api_token_id = at.id
        AND akrl.organization_id = at.organization_id
      WHERE at.token_hash = ?
        AND at.organization_id IS NOT NULL
        AND at.deleted_at IS NULL
        AND at.revoked_at IS NULL
        AND (at.expires_at IS NULL OR at.expires_at > NOW())`,
    [tokenHash],
  ));

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid or expired API token');
  }

  const token = rows[0];

  if (token.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }
  const principal = await resolveOrgPrincipal({
    id: token.user_id,
    email: token.email,
    role: token.role,
    status: token.status,
    organization_id: token.user_home_organization_id,
    is_install_operator: token.is_install_operator,
  }, token.token_organization_id, { allowOperator: false });
  if (!principal) {
    throw new UnauthorizedError('API token owner no longer has access to the token organization');
  }

  // Avoid a hot control-plane row and binlog write for every collector packet.
  // Authentication still reads live revocation state on every request; only
  // the informational last-used marker is coalesced to at most once a minute
  // per stable source IP. The SQL predicate also closes concurrent races.
  const requestIp = req.ip || null;
  const lastUsedAt = token.last_used_at ? new Date(token.last_used_at).getTime() : Number.NaN;
  const recentlyTracked = Number.isFinite(lastUsedAt)
    && Date.now() - lastUsedAt < 60 * 1000
    && (token.last_used_ip ?? null) === requestIp;
  if (!recentlyTracked) {
    await db.withPrimaryContext(() => db.query(
      `UPDATE api_tokens SET last_used_at = NOW(), last_used_ip = ?
        WHERE id = ?
          AND (last_used_at IS NULL
            OR last_used_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE)
            OR NOT (last_used_ip <=> ?))`,
      [requestIp, token.id, requestIp],
    ));
  }

  const hasRateLimitPolicy = token.rate_limit_policy_id !== null
    && token.rate_limit_policy_id !== undefined;
  const apiTokenRateLimitPolicy = hasRateLimitPolicy ? {
    requests_per_minute: token.requests_per_minute,
    requests_per_hour: token.requests_per_hour,
    requests_per_day: token.requests_per_day,
    burst_size: token.burst_size,
    is_active: token.rate_limit_policy_active,
  } : null;

  req.user = {
    id: token.user_id,
    email: token.email,
    role: principal.authorizationRole,
    membershipRole: principal.membershipRole,
    organizationId: principal.organizationId,
    isInstallOperator: false,
    isSuperAdmin: false,
    hasGlobalOrganizationAccess: false,
    apiTokenId: token.id,
    // Preserve valid deny-all [] and malformed values for fail-closed scope
    // enforcement. Only a real SQL NULL is the legacy-unrestricted sentinel.
    scopes: token.scopes,
    scopesSqlNull: Boolean(token.scopes_sql_null),
    apiTokenRateLimitPolicy,
  };

  return true;
}

/**
 * Require authentication. Attaches req.user with id, email, role, orgId, etc.
 * Supports both Bearer JWT tokens and X-API-Key header.
 * For the browser SPA, also accepts the JWT from the `fireisp_access` httpOnly cookie.
 */
const AUTHENTICATED_REQUEST = Symbol('fireisp.authenticatedRequest');

async function authenticate(req, _res, next) {
  try {
    // Admin-tier routes authenticate before the IP policy can resolve the
    // active organization, and their routers also carry the normal auth guard.
    // A module-local Symbol makes that composition idempotent without trusting
    // any client-controlled request property.
    if (req[AUTHENTICATED_REQUEST] === true) return next();

    // Try API key first
    const apiKeyAuth = await authenticateApiToken(req);
    if (apiKeyAuth) {
      req[AUTHENTICATED_REQUEST] = true;
      return next();
    }

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
    const targetOrganizationId = payload.orgId || user.organization_id;
    const principal = await resolveOrgPrincipal(user, targetOrganizationId);
    if (!principal) throw new UnauthorizedError('User no longer has access to the selected organization');

    req.user = {
      id: user.id,
      email: user.email,
      role: principal.authorizationRole,
      membershipRole: principal.membershipRole,
      organizationId: principal.organizationId,
      isInstallOperator: principal.isInstallOperator,
      isSuperAdmin: principal.isSuperAdmin,
      hasGlobalOrganizationAccess: principal.hasGlobalOrganizationAccess,
    };

    req[AUTHENTICATED_REQUEST] = true;
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
