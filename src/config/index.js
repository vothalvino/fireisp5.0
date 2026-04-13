// =============================================================================
// FireISP 5.0 — Application Configuration
// =============================================================================

const parseIntEnv = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-to-a-random-64-char-string',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
  },

  log: {
    level: process.env.LOG_LEVEL || 'debug',
  },

  // CORS — comma-separated allowlist of origins, e.g. "https://app.fireisp.com,https://admin.fireisp.com"
  corsOrigins: process.env.CORS_ORIGINS || '',

  // Rate limit overrides (requests per window)
  rateLimit: {
    windowMs: parseIntEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    api: parseIntEnv('RATE_LIMIT_API', 200),
    auth: parseIntEnv('RATE_LIMIT_AUTH', 20),
    public: parseIntEnv('RATE_LIMIT_PUBLIC', 60),
    upload: parseIntEnv('RATE_LIMIT_UPLOAD', 30),
    export: parseIntEnv('RATE_LIMIT_EXPORT', 20),
    sse: parseIntEnv('RATE_LIMIT_SSE', 10),
    webhook: parseIntEnv('RATE_LIMIT_WEBHOOK', 100),
  },
};
