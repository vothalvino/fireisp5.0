// =============================================================================
// FireISP 5.0 — Quota Check Middleware
// =============================================================================
// Usage:
//   const { quotaCheck } = require('../middleware/checkQuota');
//   router.post('/', authenticate, orgScope, quotaCheck('clients'), ctrl.create);
// =============================================================================

const { checkQuota } = require('../services/quotaService');

/**
 * Returns an Express middleware that enforces the named resource quota for the
 * requesting organization before allowing the handler to continue.
 *
 * @param {'clients'|'devices'|'storage_mb'|'scheduled_tasks'} resource
 */
function quotaCheck(resource) {
  return async function checkQuotaMiddleware(req, res, next) {
    try {
      await checkQuota(req.orgId, resource);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { quotaCheck };
