// =============================================================================
// FireISP 5.0 — Application Configuration
// =============================================================================

const parseIntEnv = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

const parseBoolEnv = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production-this-default-jwt-secret-is-not-secure!!!',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
  },

  log: {
    level: process.env.LOG_LEVEL || 'debug',
  },

  // CORS — comma-separated allowlist of origins, e.g. "https://app.fireisp.com,https://admin.fireisp.com"
  corsOrigins: process.env.CORS_ORIGINS || '',

  // IP allowlist for admin endpoints — comma-separated IPv4 addresses and/or CIDR ranges.
  // When not set the feature is disabled and all IPs are allowed (existing behaviour preserved).
  // Example: "10.0.0.0/8,203.0.113.5"
  adminIpAllowlist: process.env.ADMIN_IP_ALLOWLIST || '',

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
    // Per-tenant limits — apply to all authenticated/org-scoped requests
    tenantWindowMs: parseIntEnv('RATE_LIMIT_TENANT_WINDOW_MS', 15 * 60 * 1000),
    tenantApi: parseIntEnv('RATE_LIMIT_TENANT_API', 500),
  },

  // Request timeout in milliseconds (0 = disabled)
  requestTimeoutMs: parseIntEnv('REQUEST_TIMEOUT_MS', 30000),

  // Feature flags — set FEATURE_*=true to enable
  features: {
    cfdi: parseBoolEnv('FEATURE_CFDI', true),
    radius: parseBoolEnv('FEATURE_RADIUS', true),
    twoFactor: parseBoolEnv('FEATURE_2FA', true),
    webhooks: parseBoolEnv('FEATURE_WEBHOOKS', true),
    snmp: parseBoolEnv('FEATURE_SNMP', true),
    sso: parseBoolEnv('FEATURE_SSO', false),
  },
};

/**
 * Validate critical environment variables at startup.
 * Called from server.js before the server begins listening.
 * Throws on misconfiguration in production; logs warnings in development.
 */
function validateEnv(logger) {
  const errors = [];
  const warnings = [];
  const isProduction = config.env === 'production';

  // JWT secret: must not be the default and must be >= 64 chars in production
  const DEFAULT_SECRET = 'change-me-in-production-this-default-jwt-secret-is-not-secure!!!';
  const secretLen = config.jwt.secret.length;
  if (config.jwt.secret === DEFAULT_SECRET) {
    const msg = 'JWT_SECRET is set to the insecure default — set a unique random string (>= 64 chars)';
    if (isProduction) errors.push(msg); else warnings.push(msg);
  }
  if (secretLen < 64 && config.jwt.secret !== DEFAULT_SECRET) {
    const msg = `JWT_SECRET is only ${secretLen} characters — use at least 64 characters for HS256`;
    if (isProduction) errors.push(msg); else warnings.push(msg);
  }

  // Encryption key: required in production for at-rest encryption of secrets
  if (!process.env.ENCRYPTION_KEY) {
    const msg = 'ENCRYPTION_KEY is not set — payment gateway secrets, PAC passwords, and webhook secrets will be stored in plaintext';
    if (isProduction) errors.push(msg); else warnings.push(msg);
  }

  // Database config: required in production
  const requiredDbVars = ['DB_HOST', 'DB_NAME'];
  for (const key of requiredDbVars) {
    if (!process.env[key]) {
      const msg = `${key} environment variable is not set`;
      if (isProduction) errors.push(msg); else warnings.push(msg);
    }
  }

  // Emit warnings
  for (const w of warnings) {
    if (logger) logger.warn(w);
  }

  // In production, abort on errors
  if (isProduction && errors.length > 0) {
    const message = 'Fatal configuration errors:\n  • ' + errors.join('\n  • ');
    throw new Error(message);
  }
}

config.validateEnv = validateEnv;

module.exports = config;
