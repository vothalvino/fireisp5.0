// =============================================================================
// FireISP 5.0 — Browser WebSocket authentication helpers
// =============================================================================
// Browsers cannot attach an Authorization header to a WebSocket upgrade and the
// SPA deliberately keeps access tokens in memory only. After a page reload,
// AuthContext can therefore restore the session from its httpOnly cookie while
// tokenStore remains empty. A second, narrowly-scoped httpOnly cookie lets the
// browser hub authenticate that exact upgrade without exposing the JWT to JS.
//
// Cookie authentication is accepted only from an explicitly allowed browser
// Origin. SameSite protects across sites; the Origin check additionally blocks
// cross-origin WebSocket hijacking from another origin on the same site.
// =============================================================================

const config = require('../config');

const BROWSER_WS_PATH = '/ws/firerelay/browser';
const BROWSER_WS_COOKIE = 'fireisp_ws_access';

/**
 * Read one cookie from a raw Cookie request header.
 * Node's upgrade request bypasses Express/cookie-parser, so parse the small
 * RFC 6265 name=value surface needed here locally.
 *
 * @param {string|string[]|undefined} header
 * @param {string} name
 * @returns {string|null}
 */
function readCookie(header, name) {
  if (typeof header !== 'string') return null;

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;

    const rawValue = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch (_err) {
      return null;
    }
  }

  return null;
}

function normalizeHttpOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch (_err) {
    return null;
  }
}

/**
 * Return the browser origins trusted to present the ambient WebSocket cookie.
 * Keep this aligned with src/app.js's CORS policy. Production is deny-by-
 * default unless APP_URL/CORS_ORIGINS contains the exact Origin; development
 * additionally supports the documented Vite/local ports.
 */
function allowedBrowserOrigins() {
  const configured = config.corsOrigins
    ? config.corsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];

  // Same-origin app traffic never needs CORS, so deployments sometimes set
  // CORS_ORIGINS only to additional integrations. APP_URL must remain trusted
  // in that case or cookie-first WS auth breaks on the app's own origin.
  const candidates = [
    config.appUrl,
    ...configured,
    ...(config.env === 'production' ? [] : [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ]),
  ];

  return new Set(candidates.map(normalizeHttpOrigin).filter(Boolean));
}

/**
 * Cookie credentials are ambient, so require the browser-supplied Origin to
 * exactly match the application's configured origin allowlist.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function isAllowedCookieOrigin(req) {
  const origin = normalizeHttpOrigin(req.headers.origin);
  return origin !== null && allowedBrowserOrigins().has(origin);
}

module.exports = {
  BROWSER_WS_PATH,
  BROWSER_WS_COOKIE,
  readCookie,
  isAllowedCookieOrigin,
};
