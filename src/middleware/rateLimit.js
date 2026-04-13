// =============================================================================
// FireISP 5.0 — Rate Limiting Middleware
// =============================================================================
// Tiered rate limits: public < general < authenticated < admin.
// Each tier has a different request quota.
// All thresholds are configurable via environment variables — see config/index.js.
// =============================================================================

const rateLimit = require('express-rate-limit');
const config = require('../config');

const rl = config.rateLimit;

const RATE_LIMITED_BODY = (msg) => ({
  error: {
    code: 'RATE_LIMITED',
    message: msg || 'Too many requests, please try again later',
  },
});

const makeLimiter = (max, msg) => rateLimit({
  windowMs: rl.windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY(msg),
});

/** General API rate limiter — configurable via RATE_LIMIT_API (default 200). */
const apiLimiter = makeLimiter(rl.api);

/** Auth endpoints — configurable via RATE_LIMIT_AUTH (default 20). */
const authLimiter = makeLimiter(rl.auth, 'Too many authentication attempts, please try again later');

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

module.exports = { apiLimiter, authLimiter, publicLimiter, uploadLimiter, exportLimiter, sseLimiter, webhookLimiter };
