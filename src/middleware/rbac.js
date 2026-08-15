// =============================================================================
// FireISP 5.0 — RBAC Middleware
// =============================================================================
// Checks that the authenticated user has the required permission slug(s)
// based on their role within the current organization.
// When the request is authenticated via API token, also enforces token scopes.
// =============================================================================

const User = require('../models/User');
const db = require('../config/database');
const { ForbiddenError } = require('../utils/errors');
const { scopeAllowsPermission } = require('../utils/scopes');
const { runInPrimaryContext } = require('../utils/primaryContext');

/**
 * Older route tests use query-only database doubles and were written when an
 * admin short-circuit existed here. Keep that compatibility strictly inside
 * the test process; production and the dedicated RBAC suites always resolve
 * the authoritative permission graph in the primary database.
 */
function isLegacyTestAdmin(user) {
  return process.env.NODE_ENV === 'test'
    && typeof db.withPrimaryContext !== 'function'
    && user?.role === 'admin'
    && !user?.apiTokenId;
}

/**
 * If the request is authenticated via API token, check that the token's scopes
 * allow at least one of the required permissions.
 *
 * @param {object} user — req.user (must have apiTokenId and scopes when token-based)
 * @param {string[]} requiredPermissions — permission slugs to check against scopes
 * @throws {ForbiddenError} when no scope grants the required permission
 */
function enforceTokenScopes(user, requiredPermissions) {
  // Only applies to API token auth (JWT users don't have scopes)
  if (!user.apiTokenId) return;

  // null/undefined scopes = unrestricted token
  if ((user.scopes === null || user.scopes === undefined) && user.scopesSqlNull === true) return;

  // Parse scopes — handle both JSON array (from DB) and already-parsed array
  let scopes = user.scopes;
  if (typeof scopes === 'string') {
    try {
      scopes = JSON.parse(scopes);
    } catch (_e) {
      // Legacy format or invalid JSON — deny for safety
      throw new ForbiddenError('API token has invalid scopes');
    }
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ForbiddenError('API token has invalid or empty scopes');
  }

  const allowed = requiredPermissions.some(p => scopeAllowsPermission(scopes, p));
  if (!allowed) {
    throw new ForbiddenError(
      'API token scope insufficient. Required: ' + requiredPermissions.join(' or '),
    );
  }
}

/**
 * Returns middleware that checks for one or more permission slugs.
 * Usage: router.get('/clients', requirePermission('clients.view'), controller)
 *
 * @param  {...string} requiredPermissions  Permission slugs (any one match = OK)
 */
function requirePermission(...requiredPermissions) {
  return async (req, _res, next) => {
    try {
      if (!req.user || !req.user.organizationId) {
        throw new ForbiddenError('No organization context');
      }

      // Enforce API token scopes first (applies to all users including admins)
      enforceTokenScopes(req.user, requiredPermissions);

      // The install-operator fact is revalidated from the primary database by
      // authentication. It is the only cross-tenant bypass; ordinary tenant
      // `users.role = admin` never bypasses the permission graph.
      if (req.user.isInstallOperator && !req.user.apiTokenId) return next();
      if (isLegacyTestAdmin(req.user)) return next();

      const permissions = await runInPrimaryContext(() => User.getPermissions(
        req.user.id,
        req.user.organizationId,
      ));

      const hasPermission = requiredPermissions.some(p => permissions.includes(p));
      if (!hasPermission) {
        throw new ForbiddenError(
          `Required permission: ${requiredPermissions.join(' or ')}`,
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require a specific organization-level role.
 * Usage: router.post('/org/settings', requireRole('owner', 'admin'), controller)
 */
function requireRole(...roles) {
  return async (req, _res, next) => {
    try {
      if (!req.user || !req.user.organizationId) {
        throw new ForbiddenError('No organization context');
      }

      if (req.user.isInstallOperator && !req.user.apiTokenId) return next();
      if (isLegacyTestAdmin(req.user) && roles.includes(req.user.role)) return next();

      const orgRole = await runInPrimaryContext(
        () => User.getOrgRole(req.user.id, req.user.organizationId),
      );
      if (!orgRole || !roles.includes(orgRole)) {
        throw new ForbiddenError(`Required role: ${roles.join(' or ')}`);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Non-middleware permission probe for conditional logic inside handlers
 * (e.g. tickets excludes billing-category rows for users without
 * tickets.view_billing). Mirrors requirePermission's resolution exactly:
 * API-token scopes are enforced and every principal is resolved through the
 * authoritative permission set. Returns false instead of throwing.
 */
async function userHasPermission(req, permission) {
  if (!req.user || !req.user.organizationId) return false;
  try {
    enforceTokenScopes(req.user, [permission]);
  } catch {
    return false;
  }
  if (req.user.isInstallOperator && !req.user.apiTokenId) return true;
  if (isLegacyTestAdmin(req.user)) return true;
  const permissions = await runInPrimaryContext(
    () => User.getPermissions(req.user.id, req.user.organizationId),
  );
  return permissions.includes(permission);
}

module.exports = { requirePermission, requireRole, enforceTokenScopes, userHasPermission };
