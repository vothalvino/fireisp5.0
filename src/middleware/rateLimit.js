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
const { AppError } = require('../utils/errors');

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
const COLLECTOR_PATH_RE = /^\/api(?:\/v1)?\/(?:radius\/accounting(?:\/tenant)?|connection-logs\/cgnat-attribution\/bindings\/ingest)\/?$/;
const isCollectorPath = req => COLLECTOR_PATH_RE.test((req.originalUrl || req.url || '').split('?')[0]);

/** General API rate limiter — configurable via RATE_LIMIT_API (default 1000). */
const apiLimiter = makeLimiter(rl.api, undefined, { skip: req => isSessionPath(req) || isCollectorPath(req) });

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

/**
 * POST /auth/verify-email/resend only — reuses the same modest budget as
 * passwordResetLimiter (RATE_LIMIT_PASSWORD_RESET, default 5), since this is
 * the same class of "sends real email, can be used to mail-bomb an address"
 * endpoint. Deliberately a SEPARATE limiter instance rather than the same
 * object mounted twice: express-rate-limit's default in-memory store keys
 * solely by IP (not by route), so sharing one instance across two routes
 * would silently merge their budgets into a single combined counter — an
 * attacker exhausting one endpoint would also lock the other out for
 * legitimate use.
 */
const verifyEmailResendLimiter = makeLimiter(rl.passwordReset, 'Too many verification email requests, please try again later');

/**
 * POST /bulk/email only — configurable via RATE_LIMIT_BULK_EMAIL (default
 * 10). Same rationale as passwordResetLimiter/verifyEmailResendLimiter: a
 * mass-send action reaching real client inboxes needs its own tighter budget
 * stacked on top of the shared apiLimiter/tenantApiLimiter, which only cap
 * request count — not the up-to-1000 recipients a single request can fan out
 * to (see checkBulkEmailDailyBudget below for the recipient-count layer).
 * A separate makeLimiter() instance (not a shared reference), same reason as
 * verifyEmailResendLimiter: express-rate-limit's default store keys by IP
 * only, so sharing an instance would merge budgets across routes.
 */
const bulkEmailLimiter = makeLimiter(rl.bulkEmail, 'Too many bulk email requests, please try again later');
/**
 * POST /portal/auth/password-reset/request only — reuses the same modest
 * budget as passwordResetLimiter (RATE_LIMIT_PASSWORD_RESET, default 5),
 * since this is the same class of "sends real email" endpoint. Deliberately
 * a SEPARATE limiter instance from the staff-side passwordResetLimiter (same
 * reasoning as verifyEmailResendLimiter above): express-rate-limit's default
 * in-memory store keys solely by IP, so sharing one instance across the
 * staff and portal routes would silently merge their budgets — an attacker
 * flooding one endpoint would also lock out legitimate use of the other.
 * This is especially relevant here since portal subscribers are far more
 * likely than office staff to share a CGNAT/NAT IP with unrelated
 * households (see sessionLimiter's skipSuccessfulRequests comment above for
 * the same concern in a different context).
 */
const portalPasswordResetLimiter = makeLimiter(rl.passwordReset, 'Too many password reset requests, please try again later');

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
 * Stores per-key hit counts and fixed-window reset times. Redis increments are
 * atomic across app instances; the memory implementation is process-local and
 * intended for development/single-instance deployments.
 */
class CacheStore {
  constructor(prefix = 'rl2_tenant:') {
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
    const result = await cacheService.incrementFixedWindow(storeKey, this.windowMs);
    return { totalHits: result.count, resetTime: new Date(result.resetAt) };
  }

  /**
   * Decrement the hit counter (used when skipFailedRequests / skipSuccessfulRequests).
   * @param {string} key
   */
  async decrement(key) {
    await cacheService.decrementFixedWindow(this.prefix + key);
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

// POST /trap-forwarding-rules/:id/test only. Separate Redis-backed instance so
// its budget is neither merged with other outbound-email endpoints nor reset
// independently on each application replica. Mounted after auth + orgScope.
const trapForwardingTestLimiter = rateLimit({
  windowMs: rl.windowMs,
  max: rl.trapForwardingTest,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: RATE_LIMITED_BODY('Too many trap forwarding tests; wait before trying again'),
  keyGenerator: req => `trap-test:${req.orgId}:${req.user?.id || 'unknown'}`,
  store: new CacheStore('rl_trap_forward_test:'),
});

// api_key_rate_limits predates the collector endpoints. NULL columns mean the
// table defaults, not "unlimited"; the route-specific collectors still retain
// their independent hard ceilings outside this policy layer.
const API_TOKEN_RATE_LIMIT_DEFAULTS = Object.freeze({
  requests_per_minute: 60,
  requests_per_hour: 1000,
  requests_per_day: 10000,
  burst_size: 20,
});

const API_TOKEN_RATE_LIMIT_WINDOWS = Object.freeze([
  { field: 'burst_size', name: 'burst', windowMs: 1000, max: 65535 },
  { field: 'requests_per_minute', name: 'minute', windowMs: 60 * 1000, max: 0xFFFFFFFF },
  { field: 'requests_per_hour', name: 'hour', windowMs: 60 * 60 * 1000, max: 0xFFFFFFFF },
  { field: 'requests_per_day', name: 'day', windowMs: 24 * 60 * 60 * 1000, max: 0xFFFFFFFF },
]);

function positiveDatabaseId(value, field) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new AppError(`Invalid ${field} for API token rate limiting`, 503, 'RATE_LIMIT_CONFIGURATION_INVALID');
  }
  return normalized;
}

function activeConfiguration(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new AppError('API token rate-limit configuration is invalid', 503, 'RATE_LIMIT_CONFIGURATION_INVALID');
}

function configuredLimit(row, window) {
  const value = row[window.field] ?? API_TOKEN_RATE_LIMIT_DEFAULTS[window.field];
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > window.max) {
    throw new AppError('API token rate-limit configuration is invalid', 503, 'RATE_LIMIT_CONFIGURATION_INVALID');
  }
  return normalized;
}

/**
 * Enforce an active api_key_rate_limits row for an authenticated API token.
 *
 * This middleware must run after authenticate + orgScope. Authentication reads
 * the policy in the same live primary-control-plane query that validates token
 * revocation and binds the organization. Counters use the same atomic shared
 * fixed-window primitive as the outer collector ceilings. The one-second burst
 * window is deliberately an abuse burst cap; minute/hour/day are separate
 * longer-lived ceilings. Missing or inactive policy rows leave only the outer
 * route ceilings in force.
 */
async function apiTokenConfiguredLimiter(req, res, next) {
  if (!req.user?.apiTokenId) return next();

  try {
    const tokenId = positiveDatabaseId(req.user.apiTokenId, 'API token ID');
    const organizationId = positiveDatabaseId(req.orgId, 'organization ID');
    const policy = req.user.apiTokenRateLimitPolicy;
    if (policy === null || policy === undefined) return next();
    if (typeof policy !== 'object' || Array.isArray(policy)) {
      throw new AppError('API token rate-limit configuration is invalid', 503, 'RATE_LIMIT_CONFIGURATION_INVALID');
    }
    if (!activeConfiguration(policy.is_active)) return next();

    const windows = API_TOKEN_RATE_LIMIT_WINDOWS.map(window => ({
      ...window,
      limit: configuredLimit(policy, window),
    }));
    const counters = await Promise.all(windows.map(window => cacheService.incrementFixedWindow(
      `rl_api_token_policy:${organizationId}:${tokenId}:${window.name}`,
      window.windowMs,
    )));

    const invalidCounter = counters.some(counter => !counter
      || !Number.isSafeInteger(Number(counter.count)) || Number(counter.count) < 1
      || !Number.isFinite(Number(counter.resetAt)));
    if (invalidCounter) {
      throw new AppError('API token rate limiter is unavailable', 503, 'RATE_LIMIT_UNAVAILABLE');
    }

    const exceededIndex = counters.findIndex((counter, index) => Number(counter.count) > windows[index].limit);
    if (exceededIndex === -1) return next();

    const exceeded = windows[exceededIndex];
    const retryAfterSeconds = Math.max(1, Math.ceil((Number(counters[exceededIndex].resetAt) - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json(RATE_LIMITED_BODY(`API token ${exceeded.name} rate limit exceeded`));
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(new AppError('API token rate limiter is unavailable', 503, 'RATE_LIMIT_UNAVAILABLE'));
  }
}

// Pre-authentication abuse ceiling for machine collectors. Successful
// collector traffic is carved out of the staff/API bucket and receives
// token-scoped limits at the routes; invalid keys remain bounded by IP here.
// CacheStore is Redis-atomic when REDIS_URL is configured (the production
// template does so) and retains a process-local development fallback.
const collectorIngressLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Math.min(Math.max(Number.parseInt(process.env.RATE_LIMIT_COLLECTOR_INGRESS_PER_MINUTE || '6000', 10) || 6000, 1), 60000),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: RATE_LIMITED_BODY('Collector ingress rate exceeded'),
  store: new CacheStore('rl_collector_ingress:'),
});

/**
 * Per-organization rolling-24h RECIPIENT-count budget for POST /bulk/email.
 *
 * Built directly on cacheService rather than express-rate-limit: the "cost"
 * of a hit (resolved, in-org recipient count) is only known after client_ids
 * are looked up, which doesn't fit express-rate-limit's per-request
 * increment-by-one model. The window is fixed at first-hit (like
 * CacheStore.increment above), not extended on every call, so a steady
 * trickle of requests cannot keep pushing the reset time forward forever.
 *
 * This recipient-cost path still uses get+set because its increment is not a
 * fixed cost of one. It is an abuse cap, not an accounting/security boundary.
 *
 * @param {number|string} orgId Organization ID (req.orgId).
 * @param {number} count Number of recipients this request would add.
 * @param {number} [limit] Daily recipient budget (default rl.bulkEmailDailyRecipients).
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
async function checkBulkEmailDailyBudget(orgId, count, limit = rl.bulkEmailDailyRecipients) {
  const key = `bulk_email_daily:${orgId}`;
  const windowMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const existing = await cacheService.get(key);
  let used = 0;
  let resetAt = now + windowMs;
  if (existing && existing.resetAt > now) {
    used = existing.count;
    resetAt = existing.resetAt;
  }
  if (used + count > limit) {
    return { allowed: false, remaining: Math.max(0, limit - used), resetAt };
  }
  const ttlSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  await cacheService.set(key, { count: used + count, resetAt }, ttlSeconds);
  return { allowed: true, remaining: limit - used - count, resetAt };
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
  verifyEmailResendLimiter,
  bulkEmailLimiter,
  portalPasswordResetLimiter,
  sessionLimiter,
  isSessionPath,
  isCollectorPath,
  collectorIngressLimiter,
  apiTokenConfiguredLimiter,
  publicLimiter,
  uploadLimiter,
  exportLimiter,
  sseLimiter,
  webhookLimiter,
  trapForwardingTestLimiter,
  tenantApiLimiter,
  checkBulkEmailDailyBudget,
  CacheStore,
};
