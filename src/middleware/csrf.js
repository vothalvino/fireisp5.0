// =============================================================================
// FireISP 5.0 — CSRF Protection Middleware (P3.4)
// =============================================================================
// Defense-in-depth CSRF guard for state-changing API requests.
//
// Primary protection: both auth cookies are set with SameSite=Strict, which
// prevents the browser from sending them on any cross-origin request.
//
// Secondary protection (this file): for state-changing requests (POST / PUT /
// PATCH / DELETE) that arrive with a FireISP browser auth cookie,
// the Origin or Referer header must match the configured APP_URL host.  This
// satisfies the "Verifying Origin With Standard Headers" CSRF mitigation from
// OWASP and suppresses the CodeQL js/missing-token-validation alert.
//
// API clients that use X-API-Key or Bearer-only (no cookie) are exempt because
// they do not rely on the cookie credential and therefore cannot be CSRF targets.
// =============================================================================

const config = require('../config');
const { URL } = require('url');

/**
 * Return the host (hostname + optional port) from a URL string, or null if
 * the string is not a valid absolute URL.
 */
function parseHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const allowedHost = parseHost(config.appUrl);

/**
 * CSRF origin check — only active when the request carries a FireISP auth
 * cookie (browser SPA path) AND the method is state-changing.
 *
 * Returns next() immediately when:
 *   - No auth cookie is present (API-key / Bearer-only clients)
 *   - Method is GET, HEAD, or OPTIONS (safe methods)
 *
 * Returns 403 when:
 *   - An auth cookie IS present AND the Origin/Referer host does not match
 *     the configured APP_URL.
 *   - An auth cookie IS present AND no Origin/Referer header is sent at all
 *     (conservative: browsers always send Origin on cross-origin POST).
 */
function csrfOriginCheck(req, res, next) {
  const method = req.method.toUpperCase();
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(method)) return next();

  // Only enforce when the request carries a FireISP auth cookie
  const hasCookie = !!(
    req.cookies?.fireisp_access ||
    req.cookies?.fireisp_refresh ||
    req.cookies?.fireisp_portal_access ||
    req.cookies?.fireisp_portal_refresh
  );
  if (!hasCookie) return next();

  // Prefer Origin header; fall back to Referer
  const originHeader = req.headers.origin || req.headers.referer || null;

  if (!originHeader) {
    // No origin info on a cookie-carrying state-changing request — reject
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'CSRF check failed: missing Origin header' },
    });
  }

  const requestHost = parseHost(originHeader);
  if (!requestHost || !allowedHost || requestHost !== allowedHost) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'CSRF check failed: Origin mismatch' },
    });
  }

  return next();
}

module.exports = { csrfOriginCheck };
