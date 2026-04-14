// =============================================================================
// FireISP 5.0 — CSRF Protection Middleware (Double-Submit Cookie)
// =============================================================================
// Uses the double-submit cookie pattern: a random token is set as a cookie
// (_csrf) readable by JavaScript, and mutating requests must echo it back in
// the X-CSRF-Token header. This is suitable for JWT-based auth where
// traditional session-bound tokens are not applicable.
// =============================================================================

const crypto = require('crypto');
const config = require('../config');

const CSRF_COOKIE = '_csrf';
const CSRF_HEADER = 'x-csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Set (or refresh) the CSRF cookie on every response so the front-end
 * always has a token available.
 */
function csrfCookie(req, res, next) {
  // Only set when there is no existing CSRF cookie
  if (!req.cookies?.[CSRF_COOKIE] && !req.headers?.cookie?.includes(CSRF_COOKIE)) {
    const token = crypto.randomBytes(32).toString('hex');
    const cookieOpts = {
      httpOnly: false, // JS must read it to send as header
      sameSite: 'Strict',
      secure: config.env === 'production',
      path: '/',
    };
    res.cookie(CSRF_COOKIE, token, cookieOpts);
  }
  next();
}

/**
 * Parse a specific cookie value from the raw Cookie header.
 */
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Validate the CSRF token on mutating requests.
 *
 * Skips validation for:
 * - Safe methods (GET, HEAD, OPTIONS)
 * - Payment webhook callbacks (external services cannot set cookies)
 * - Requests authenticated via Authorization: Bearer (API tokens are immune)
 * - Non-browser requests (no Cookie header present)
 */
function csrfProtection(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  // Skip external webhook callbacks
  if (req.originalUrl?.startsWith('/api/payment-webhooks') || req.originalUrl?.startsWith('/api/v1/payment-webhooks')) {
    return next();
  }

  // Skip API-token authenticated requests (Bearer auth is not vulnerable to CSRF)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  // Skip non-browser requests (no cookies means no CSRF risk)
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return next();

  const cookieToken = parseCookie(cookieHeader, CSRF_COOKIE);
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      error: { code: 'CSRF_VALIDATION_FAILED', message: 'Invalid or missing CSRF token' },
    });
  }

  next();
}

module.exports = { csrfProtection, csrfCookie };
