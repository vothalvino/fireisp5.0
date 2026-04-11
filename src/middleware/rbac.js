// =============================================================================
// FireISP 5.0 — RBAC Middleware
// =============================================================================
// Checks that the authenticated user has the required permission slug(s)
// based on their role within the current organization.
// =============================================================================

const User = require('../models/User');
const { ForbiddenError } = require('../utils/errors');

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

      // Admin users in the legacy `users.role` field bypass RBAC
      if (req.user.role === 'admin') {
        return next();
      }

      const permissions = await User.getPermissions(
        req.user.id,
        req.user.organizationId,
      );

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

      const orgRole = await User.getOrgRole(req.user.id, req.user.organizationId);
      if (!orgRole || !roles.includes(orgRole)) {
        throw new ForbiddenError(`Required role: ${roles.join(' or ')}`);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission, requireRole };
