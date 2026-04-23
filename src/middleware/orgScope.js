// =============================================================================
// FireISP 5.0 — Organization Scoping Middleware
// =============================================================================
// Ensures every request is scoped to the user's current organization.
// Attaches req.orgId for use in controllers/services.
// Also enforces the per-tenant API rate limit so each organization's quota is
// tracked independently across all of its users.
// =============================================================================

const { ForbiddenError } = require('../utils/errors');
const { tenantApiLimiter } = require('./rateLimit');

/**
 * Extracts and validates the organization context from the authenticated user.
 * Must run after auth middleware.
 */
function orgScope(req, res, next) {
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

  // Apply per-tenant rate limiting now that req.orgId is set
  tenantApiLimiter(req, res, next);
}

module.exports = { orgScope };
