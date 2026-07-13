// =============================================================================
// FireISP 5.0 — Rate Limiting Middleware
// =============================================================================
// Tiered rate limits: public < general < authenticated < admin.
// Each tier has a different request quota.
// All thresholds are configurable via environment variables — see config/index.js.
//
// Per-tenant rate limiting is layered on top of the IP-based limits.
// Authenticated requests are additionally limited per organization so that one
// tenant's traffic cannot starve another.  The tenant limiter uses the shared
// cacheService (Redis when available, in-memory otherwise) for accurate counts
// across multiple app instances.
// =============================================================================

const rateLimit = require('express-rate-limit');
const config = require('../config');
const cacheService = require('../services/cacheService');

const rl = config.rateLimit;

const RATE_LIMITED_BODY = (msg) => ({
  error: {
    code: 'RATE_LIMITED',
    message: msg || 'Too many requests, please try again later',
  },
});

const makeLimiter = (max, msg, extra = {}) => rateLimit({
  windowMs: rl.windowMs,
  max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: RATE_LIMITED_BODY(msg),
  ...extra,
});

// Session-keepalive endpoints — staff SPA and subscriber portal. These are
// what keeps a logged-in user logged in: the SPAs re-bootstrap via /me +
// /refresh on every reload and silently refresh when the access token
// expires. They are carved OUT of the general API bucket (see `skip` below)
// and given their own per-IP budget — otherwise a chatty dashboard exhausts
// the shared budget and the resulting 429 on /auth/refresh bounces an active
// user to the login screen.
const SESSION_PATH_RE = /^\/api(?:\/v1)?\/(?:auth|portal\/auth)\/(?:me|refresh|logout|switch-organization)\/?$/;
const isSessionPath = (req) => SESSION_PATH_RE.test((req.originalUrl || req.url || '').split('?')[0]);

/** General API rate limiter — configurable via RATE_LIMIT_API (default 1000). */
const apiLimiter = makeLimiter(rl.api, undefined, { skip: isSessionPath });

/**
 * Session-keepalive endpoints — configurable via RATE_LIMIT_SESSION (default 240).
 *
 * skipSuccessfulRequests: successful keepalives (2xx) don't count against the
 * budget, so ANY number of legitimate users behind one office NAT / CGNAT IP
 * can stay logged in — only FAILURES count (401s from token guessing, broken
 * clients, etc.), which is exactly the abuse this limiter exists to cap.
 */
const sessionLimiter = makeLimiter(rl.session, 'Too many session requests, please try again later', {
  skipSuccessfulRequests: true,
});

/** Auth endpoints — configurable via RATE_LIMIT_AUTH (default 20). */
const authLimiter = makeLimiter(rl.auth, 'Too many authentication attempts, please try again later');

/**
 * POST /auth/password-reset/request only — configurable via
 * RATE_LIMIT_PASSWORD_RESET (default 5). Stacks ON TOP of the shared
 * authLimiter above (which already covers this route by prefix): this one is
 * deliberately tighter and scoped to a single route, since sending real email
 * makes it a mail-bombing / enumeration-timing target distinct from
 * login/register, which share the looser budget.
 */
const passwordResetLimiter = makeLimiter(rl.passwordReset, 'Too many password reset requests, please try again later');

/** Public endpoints — configurable via RATE_LIMIT_PUBLIC (default 60). */
const publicLimiter = makeLimiter(rl.public);

/** Upload endpoints — configurable via RATE_LIMIT_UPLOAD (default 30). */
const uploadLimiter = makeLimiter(rl.upload, 'Too many upload requests, please try again later');

/** Export endpoints — configurable via RATE_LIMIT_EXPORT (default 20). */
const exportLimiter = makeLimiter(rl.export, 'Too many export requests, please try again later');

/** SSE endpoints — configurable via RATE_LIMIT_SSE (default 10). */
const sseLimiter = makeLimiter(rl.sse, 'Too many SSE connections, please try again later');

/** Payment webhook endpoints — configurable via RATE_LIMIT_WEBHOOK (default 100). */
const webhookLimiter = makeLimiter(rl.webhook, 'Too many webhook requests, please try again later');

// =============================================================================
// Per-tenant rate limiting
// =============================================================================

/**
 * express-rate-limit store backed by cacheService (Redis or in-memory LRU).
 * Stores per-key hit counts and sliding-window reset times.
 *
 * Note: the get+set pair is not atomic on Redis, so counts may be slightly
 * imprecise under extreme concurrency.  For rate limiting purposes this
 * trade-off is acceptable — correctness at the margins matters less than
 * avoiding the need for a dedicated rate-limit Redis library.
 */
class CacheStore {
  constructor(prefix = 'rl_tenant:') {
    this.prefix = prefix;
    this.windowMs = null;
  }

  /** Called by express-rate-limit with the resolved options object. */
  init(options) {
    this.windowMs = options.windowMs;
  }

  /**
   * Increment the hit counter for the given key.
   * @param {string} key
   * @returns {Promise<{totalHits: number, resetTime: Date}>}
   */
  async increment(key) {
    const storeKey = this.prefix + key;
    const now = Date.now();
    const windowMs = this.windowMs;
    const ttlSeconds = Math.ceil(windowMs / 1000);

    const existing = await cacheService.get(storeKey);

    if (!existing || existing.resetTime <= now) {
      // First hit in this window (or window has already expired)
      const resetTime = new Date(now + windowMs);
      await cacheService.set(storeKey, { hits: 1, resetTime: resetTime.getTime() }, ttlSeconds);
      return { totalHits: 1, resetTime };
    }

    const hits = existing.hits + 1;
    const remainingTtl = Math.ceil((existing.resetTime - now) / 1000);
    await cacheService.set(storeKey, { hits, resetTime: existing.resetTime }, remainingTtl > 0 ? remainingTtl : ttlSeconds);
    return { totalHits: hits, resetTime: new Date(existing.resetTime) };
  }

  /**
   * Decrement the hit counter (used when skipFailedRequests / skipSuccessfulRequests).
   * @param {string} key
   */
  async decrement(key) {
    const storeKey = this.prefix + key;
    const existing = await cacheService.get(storeKey);
    if (!existing || existing.hits <= 0) return;
    const remainingTtl = Math.ceil((existing.resetTime - Date.now()) / 1000);
    if (remainingTtl > 0) {
      await cacheService.set(storeKey, { hits: existing.hits - 1, resetTime: existing.resetTime }, remainingTtl);
    }
  }

  /**
   * Reset the hit counter for the given key.
   * @param {string} key
   */
  async resetKey(key) {
    await cacheService.del(this.prefix + key);
  }

  /** Reset all keys — not feasible without key scanning, so this is a no-op. */
  async resetAll() {
    // Intentional no-op: we cannot enumerate all keys through the cacheService
    // abstraction. Keys expire naturally via their TTL.
  }
}

/**
 * Per-tenant API rate limiter.
 *
 * Keyed by organization ID (req.orgId) so that each tenant's quota is tracked
 * independently.  Must be applied after authenticate + orgScope middleware so
 * that req.orgId is already set.
 *
 * Configurable via:
 *   RATE_LIMIT_TENANT_WINDOW_MS  (default 900000 = 15 min)
 *   RATE_LIMIT_TENANT_API        (default 500 requests per window)
 */
const tenantApiLimiter = rateLimit({
  windowMs: rl.tenantWindowMs,
  max: rl.tenantApi,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: RATE_LIMITED_BODY('Tenant API rate limit exceeded, please slow down'),
  keyGenerator: (req) => `tenant:${req.orgId}`,
  store: new CacheStore(),
});

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  sessionLimiter,
  isSessionPath,
  publicLimiter,
  uploadLimiter,
  exportLimiter,
  sseLimiter,
  webhookLimiter,
  tenantApiLimiter,
  CacheStore,
};
