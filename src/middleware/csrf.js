// =============================================================================
// FireISP 5.0 — CSRF Protection Middleware (P3.4)
// =============================================================================
// Defense-in-depth CSRF guard for state-changing API requests.
//
// Primary protection: both auth cookies are set with SameSite=Strict, which
// prevents the browser from sending them on any cross-origin request.
//
// CSRF token protection (double-submit cookie + csrf library):
//   1. On login / token refresh the server generates a CSRF secret (via the
//      `csrf` library) and stores it in an httpOnly `fireisp_csrf_secret`
//      cookie.  A derived CSRF token is stored in a non-httpOnly
//      `fireisp_csrf` cookie that the browser SPA can read.
//   2. The SPA reads `fireisp_csrf` and echoes it back as the `X-CSRF-Token`
//      request header on every state-changing request.
//   3. This middleware reads the secret from the httpOnly cookie and calls
//      `Tokens.verify(secret, token)` — this is the CodeQL-recognised
//      js/missing-token-validation CSRF mitigation pattern.
//
// Fallback: sessions without a CSRF secret cookie fall back to an
// Origin/Referer header check for backward compatibility.
//
// Exempt from CSRF enforcement:
//   - Requests without a FireISP auth cookie (API-key clients, unauthenticated)
//   - Requests carrying `Authorization: Bearer` (custom headers cannot be forged
//     cross-origin, so these are inherently CSRF-safe even when cookies are present)
// =============================================================================

const Tokens = require('csrf');
const config = require('../config');
const { URL } = require('url');

const tokens = new Tokens();

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
// Cookie names
// ---------------------------------------------------------------------------
const CSRF_SECRET_COOKIE = 'fireisp_csrf_secret'; // httpOnly — server reads it
const CSRF_TOKEN_COOKIE  = 'fireisp_csrf';         // NOT httpOnly — SPA reads it
const CSRF_HEADER        = 'x-csrf-token';

// ---------------------------------------------------------------------------
// CSRF cookie helpers
// ---------------------------------------------------------------------------

/**
 * Cookie options for the CSRF *secret* cookie (httpOnly, server-only).
 */
function secretCookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/api',
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

/**
 * Cookie options for the CSRF *token* cookie (NOT httpOnly so the SPA can read it).
 */
function tokenCookieOptions(maxAge) {
  return {
    httpOnly: false,       // Must be readable by client-side JavaScript
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/api',
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

/**
 * Set CSRF cookies alongside the auth cookies.
 *
 * Sets:
 *   - `fireisp_csrf_secret` (httpOnly) — the CSRF secret (server-only)
 *   - `fireisp_csrf` (not httpOnly) — the derived CSRF token (SPA reads + sends as header)
 *
 * @param {import('express').Response} res
 * @param {number} maxAgeMs  Cookie lifetime in milliseconds (should match access token).
 */
function setCsrfCookie(res, maxAgeMs) {
  const secret = tokens.secretSync();
  const token  = tokens.create(secret);
  res.cookie(CSRF_SECRET_COOKIE, secret, secretCookieOptions(maxAgeMs));
  res.cookie(CSRF_TOKEN_COOKIE,  token,  tokenCookieOptions(maxAgeMs));
}

/**
 * Clear the CSRF cookies (call alongside clearAuthCookies).
 * @param {import('express').Response} res
 */
function clearCsrfCookie(res) {
  res.clearCookie(CSRF_SECRET_COOKIE, secretCookieOptions());
  res.clearCookie(CSRF_TOKEN_COOKIE,  tokenCookieOptions());
}

// ---------------------------------------------------------------------------
// csrfOriginCheck middleware
// ---------------------------------------------------------------------------

/**
 * CSRF protection middleware — token validation via `csrf` library with
 * Origin/Referer fallback for backward compatibility.
 *
 * Returns next() immediately when:
 *   - Method is GET, HEAD, or OPTIONS (safe methods)
 *   - No auth cookie is present (API-key / Bearer-only clients)
 *
 * When the `fireisp_csrf_secret` cookie is present (new sessions):
 *   - Reads the CSRF token from the `X-CSRF-Token` request header.
 *   - Verifies with `tokens.verify(secret, token)` (CodeQL-recognised pattern).
 *   - Returns 403 if the token is missing or fails verification.
 *
 * When the `fireisp_csrf_secret` cookie is absent (legacy sessions):
 *   - Falls back to Origin/Referer header check.
 */
function csrfOriginCheck(req, res, next) {
  const method = req.method.toUpperCase();
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(method)) return next();

  // Only enforce when the request carries a FireISP auth cookie
  const hasCookie = !!(req.cookies?.fireisp_access || req.cookies?.fireisp_refresh);
  if (!hasCookie) return next();

  // Bearer-token requests cannot be forged via CSRF because cross-origin
  // requests cannot set custom `Authorization` headers without a CORS
  // pre-flight that the server would reject.  The SPA uses both Bearer token
  // and cookies, so we must exempt it here to avoid double-enforcement.
  const hasBearer = typeof req.headers?.authorization === 'string' &&
    req.headers.authorization.startsWith('Bearer ');
  if (hasBearer) return next();

  // --- Primary: csrf-library token verification ---
  const secret = req.cookies?.[CSRF_SECRET_COOKIE];
  if (secret) {
    const csrfToken = req.headers[CSRF_HEADER] || req.body?._csrf;
    if (!csrfToken || !tokens.verify(secret, csrfToken)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'CSRF check failed: invalid or missing CSRF token' },
      });
    }
    return next();
  }

  // --- Fallback: Origin/Referer check (backward compat for pre-CSRF-cookie sessions) ---
  const originHeader = req.headers.origin || req.headers.referer || null;

  if (!originHeader) {
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
