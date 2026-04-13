// =============================================================================
// FireISP 5.0 — Feature Flag Middleware
// =============================================================================
// Returns 404 when a feature flag is disabled, preventing access to routes
// that belong to optional subsystems (CFDI, RADIUS, 2FA, Webhooks, SNMP).
// =============================================================================

const config = require('../config');

/**
 * Returns middleware that rejects the request when the named feature is disabled.
 *
 * @param {string} flagName  Key in config.features (e.g. 'cfdi', 'radius')
 */
function requireFeature(flagName) {
  return (_req, res, next) => {
    if (config.features[flagName]) {
      return next();
    }
    res.status(404).json({
      error: {
        code: 'FEATURE_DISABLED',
        message: `The ${flagName} feature is not enabled`,
      },
    });
  };
}

module.exports = { requireFeature };
