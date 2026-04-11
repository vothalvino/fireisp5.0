// =============================================================================
// FireISP 5.0 — Organization Scoping Middleware
// =============================================================================
// Ensures every request is scoped to the user's current organization.
// Attaches req.orgId for use in controllers/services.
// =============================================================================

const { ForbiddenError } = require('../utils/errors');

/**
 * Extracts and validates the organization context from the authenticated user.
 * Must run after auth middleware.
 */
function orgScope(req, _res, next) {
  if (!req.user) {
    return next(new ForbiddenError('Authentication required'));
  }

  // Organization ID comes from JWT payload (set at login)
  const orgId = req.user.organizationId;
  if (!orgId) {
    return next(new ForbiddenError('No organization context — select an organization'));
  }

  // Attach for downstream use
  req.orgId = orgId;
  next();
}

module.exports = { orgScope };
