// =============================================================================
// FireISP 5.0 — Organization Locale Middleware
// =============================================================================
// Gates Mexico-specific compliance routes (SAT CFDI 4.0, IFT/CRT, PROFECO) to
// organizations whose regional-compliance switch is 'MX'. Companion to the
// data-layer enforcement triggers (migrations 087/088/097), which reject MX
// rows for non-MX clients/orgs — this adds the app-layer gate so the surface
// is not reachable at all for global-locale tenants.
//
// Must run AFTER orgScope (needs req.orgId). Responds 404 in the same shape as
// featureFlag.js so clients treat a region-disabled module like a missing one.
// =============================================================================

const Organization = require('../models/Organization');

/**
 * Reject the request with 404 REGION_DISABLED unless the active organization's
 * compliance locale is 'MX'.
 */
function requireMxLocale(req, res, next) {
  Organization.getLocale(req.orgId)
    .then((locale) => {
      if (locale === 'MX') return next();
      return res.status(404).json({
        error: {
          code: 'REGION_DISABLED',
          message: 'This feature requires the organization locale to be MX',
        },
      });
    })
    .catch(next);
}

module.exports = { requireMxLocale };
