// =============================================================================
// FireISP 5.0 — CSRF Protection Middleware (P3.4)
// =============================================================================
// Defense-in-depth CSRF guard for state-changing API requests.
//
// Primary protection: both auth cookies are set with SameSite=Strict, which
// prevents the browser from sending them on any cross-origin request.
//
// CSRF token protection (double-submit cookie pattern):
//   1. On login / token refresh the server sets a non-httpOnly `fireisp_csrf`
//      cookie containing a cryptographically-random token.
//   2. The browser SPA reads the cookie value (readable because it is NOT
//      httpOnly) and echoes it back as the `X-CSRF-Token` request header on
//      every state-changing request.
//   3. This middleware verifies header === cookie.  An attacker on another
//      origin cannot read the cookie due to the Same-Origin Policy, and
//      SameSite=Strict prevents the browser from sending the auth cookies on
//      cross-origin requests at all.
//   This satisfies the CodeQL js/missing-token-validation query.
//
// Fallback (origin check): sessions that pre-date CSRF cookie issuance (no
// `fireisp_csrf` cookie) fall back to the Origin/Referer header check for
// backward compatibility.
//
// API clients that use X-API-Key or Bearer-only (no auth cookie) are exempt.
// =============================================================================

const crypto = require('crypto');
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

// ---------------------------------------------------------------------------
// CSRF cookie helpers
// ---------------------------------------------------------------------------

const CSRF_COOKIE = 'fireisp_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** Cookie options for the CSRF token (NOT httpOnly so the SPA can read it). */
function csrfCookieOptions(maxAge) {
  return {
    httpOnly: false,       // Must be readable by client-side JavaScript
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/api',
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

/**
 * Set a CSRF double-submit token cookie alongside the auth cookies.
 * @param {import('express').Response} res
 * @param {number} maxAgeMs  Cookie lifetime in milliseconds (should match access token).
 * @returns {string} The generated CSRF token.
 */
function setCsrfCookie(res, maxAgeMs) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions(maxAgeMs));
  return token;
}

/**
 * Clear the CSRF token cookie (call alongside clearAuthCookies).
 * @param {import('express').Response} res
 */
function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
}

// ---------------------------------------------------------------------------
// csrfOriginCheck middleware
// ---------------------------------------------------------------------------

/**
 * CSRF protection middleware — double-submit cookie check with Origin fallback.
 *
 * Returns next() immediately when:
 *   - Method is GET, HEAD, or OPTIONS (safe methods)
 *   - No auth cookie is present (API-key / Bearer-only clients)
 *
 * When the `fireisp_csrf` cookie is present (new sessions):
 *   - Requires the `X-CSRF-Token` request header to equal the cookie value.
 *   - Returns 403 if header is missing or does not match.
 *
 * When the `fireisp_csrf` cookie is absent (legacy / non-browser sessions):
 *   - Falls back to Origin/Referer header check.
 *   - Returns 403 if Origin/Referer is missing or doesn't match APP_URL.
 */
function csrfOriginCheck(req, res, next) {
  const method = req.method.toUpperCase();
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(method)) return next();

  // Only enforce when the request carries a FireISP auth cookie
  const hasCookie = !!(req.cookies?.fireisp_access || req.cookies?.fireisp_refresh);
  if (!hasCookie) return next();

  // --- Primary: double-submit CSRF token check ---
  const csrfCookieVal = req.cookies?.[CSRF_COOKIE];
  if (csrfCookieVal) {
    const csrfHeader = req.headers[CSRF_HEADER];
    if (!csrfHeader || csrfHeader !== csrfCookieVal) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'CSRF check failed: invalid or missing CSRF token' },
      });
    }
    return next();
  }

  // --- Fallback: Origin/Referer check (backward compat for pre-CSRF-cookie sessions) ---
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

module.exports = { csrfOriginCheck, setCsrfCookie, clearCsrfCookie };
