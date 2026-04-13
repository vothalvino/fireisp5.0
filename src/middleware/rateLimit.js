// =============================================================================
// FireISP 5.0 — Rate Limiting Middleware
// =============================================================================
// Tiered rate limits: public < general < authenticated < admin.
// Each tier has a different request quota.
// =============================================================================

const rateLimit = require('express-rate-limit');

const RATE_LIMITED_BODY = (msg) => ({
  error: {
    code: 'RATE_LIMITED',
    message: msg || 'Too many requests, please try again later',
  },
});

/**
 * General API rate limiter — 200 requests per 15-minute window per IP.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY(),
});

/**
 * Stricter limiter for auth endpoints — 20 requests per 15-minute window per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY('Too many authentication attempts, please try again later'),
});

/**
 * Public endpoints (unauthenticated) — 60 requests per 15-minute window per IP.
 * Use for: health, public docs, events.
 */
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY(),
});

/**
 * Upload endpoints — 30 requests per 15-minute window per IP.
 * Use for: file uploads, import endpoints.
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY('Too many upload requests, please try again later'),
});

/**
 * Export endpoints — 20 requests per 15-minute window per IP.
 * PDF and CSV generation is CPU-intensive.
 */
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY('Too many export requests, please try again later'),
});

/**
 * SSE endpoints — 10 concurrent connections per IP per 15-minute window.
 * SSE streams are long-lived; this prevents a single IP from exhausting
 * server resources by opening many parallel connections.
 */
const sseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY('Too many SSE connections, please try again later'),
});

module.exports = { apiLimiter, authLimiter, publicLimiter, uploadLimiter, exportLimiter, sseLimiter };
