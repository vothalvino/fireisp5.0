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

const DEFAULT_JWT_SECRET = 'change-me-in-production-this-default-jwt-secret-is-not-secure!!!';
const REQUIRED_JWT_ALGORITHM = 'HS256';
const HEX_64_RE = /^[0-9a-fA-F]{64}$/;

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '60m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: process.env.JWT_ALGORITHM || REQUIRED_JWT_ALGORITHM,
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

  // Embedded RADIUS server (auth + accounting). Opt-in: enable to make FireISP
  // itself the RADIUS server for NAS devices (no external FreeRADIUS needed).
  radiusServer: {
    enabled: parseBoolEnv('RADIUS_SERVER_ENABLED', false),
    authPort: parseIntEnv('RADIUS_AUTH_PORT', 1812),
    acctPort: parseIntEnv('RADIUS_ACCT_PORT', 1813),
    // Fallback shared secret for NAS clients that have no per-NAS secret set
    // (per-NAS nas.secret is preferred). Empty = require a per-NAS secret.
    secret: process.env.RADIUS_SERVER_SECRET || '',
  },

  // WireGuard VPN hub — two surfaces: per-NAS tunnels (wg-fireisp) + user access tunnels (wg-clients).
  // Set WG_SERVER_ENABLED=true only on a Linux host with CAP_NET_ADMIN and wireguard-tools installed.
  // When disabled (default), config/QR files are still issued but the operator wires peers manually.
  // HARD CONSTRAINT: FireISP NEVER writes /ip/service or /ip/firewall on the router.
  wireguard: {
    serverEnabled:    parseBoolEnv('WG_SERVER_ENABLED', false),
    serverInterface:  process.env.WG_SERVER_INTERFACE  || 'wg-fireisp',
    serverEndpoint:   process.env.WG_ENDPOINT_HOST     || '',    // public host/IP both NAS + user clients dial
    serverListenPort: parseIntEnv('WG_LISTEN_PORT',        51820),
    serverPublicKey:  process.env.WG_SERVER_PUBLIC_KEY  || '',   // wg-fireisp public key (from wg-quick conf)
    serverSubnet:     process.env.WG_SERVER_SUBNET      || '10.255.0.0/16', // NAS peer pool
    keepalive:        parseIntEnv('WG_KEEPALIVE',           25),
    clientInterface:  process.env.WG_CLIENT_INTERFACE   || 'wg-clients',
    clientSubnet:     process.env.WG_CLIENT_SUBNET      || '10.99.0.0/16',  // user peer pool
    clientListenPort: parseIntEnv('WG_CLIENT_LISTEN_PORT', 51821),
    clientPublicKey:  process.env.WG_CLIENT_SERVER_PUBLIC_KEY || '', // wg-clients public key handed to users in .conf
  },

  // Feature flags — set FEATURE_*=true to enable
  features: {
    cfdi: parseBoolEnv('FEATURE_CFDI', true),
    radius: parseBoolEnv('FEATURE_RADIUS', true),
    twoFactor: parseBoolEnv('FEATURE_2FA', true),
    webhooks: parseBoolEnv('FEATURE_WEBHOOKS', true),
    snmp: parseBoolEnv('FEATURE_SNMP', true),
    sso: parseBoolEnv('FEATURE_SSO', false),
  },

  // Geocoding — resolves a client service address to GPS coordinates for the
  // map pin (isp-platform-features.md §1.1). Disabled when no API key is set.
  geocoding: {
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    timeoutMs: parseIntEnv('GEOCODING_TIMEOUT_MS', 8000),
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
  // The insecure default JWT secret, a non-HS256 algorithm, or a wrong-length
  // secret are only tolerable in a local dev/test sandbox. Treat them as FATAL
  // in every other environment (production, staging, or any custom NODE_ENV) so
  // an internet-exposed non-prod instance can never run with a forgeable
  // token-signing secret.
  const allowInsecureSecret = config.env === 'development' || config.env === 'test';

  // JWT secret: must be the generated local 64-character HS256 secret outside dev/test.
  const secretLen = config.jwt.secret.length;
  if (config.jwt.algorithm !== REQUIRED_JWT_ALGORITHM) {
    const msg = `JWT_ALGORITHM must be ${REQUIRED_JWT_ALGORITHM}`;
    if (!allowInsecureSecret) errors.push(msg); else warnings.push(msg);
  }
  if (config.jwt.secret === DEFAULT_JWT_SECRET) {
    const msg = 'JWT_SECRET is set to the insecure default — set a unique random 64-character HS256 secret';
    if (!allowInsecureSecret) errors.push(msg); else warnings.push(msg);
  }
  if (secretLen !== 64 && config.jwt.secret !== DEFAULT_JWT_SECRET) {
    const msg = 'JWT_SECRET must be exactly 64 characters for HS256';
    if (!allowInsecureSecret) errors.push(msg); else warnings.push(msg);
  }

  // Encryption key: required in production for at-rest encryption of secrets
  if (!process.env.ENCRYPTION_KEY) {
    const msg = 'ENCRYPTION_KEY is not set — payment gateway secrets, PAC passwords, and webhook secrets will be stored in plaintext';
    if (isProduction) errors.push(msg); else warnings.push(msg);
  } else if (!HEX_64_RE.test(process.env.ENCRYPTION_KEY)) {
    const msg = 'ENCRYPTION_KEY must be a 64-character hex string (256 bits)';
    if (isProduction) errors.push(msg); else warnings.push(msg);
  }

  // WireGuard: fatal in production when server mode is enabled without the
  // required endpoint + public key env vars (keys live in wg-quick conf files,
  // never in DB; these env vars are the app's view of them).
  if (config.wireguard.serverEnabled && isProduction) {
    if (!config.wireguard.serverEndpoint) {
      errors.push('WG_SERVER_ENABLED=true in production but WG_ENDPOINT_HOST is not set (NAS and user clients need a reachable endpoint)');
    }
    if (!config.wireguard.serverPublicKey) {
      errors.push('WG_SERVER_ENABLED=true in production but WG_SERVER_PUBLIC_KEY is not set (required for NAS peer config generation)');
    }
    if (!config.wireguard.clientPublicKey) {
      errors.push('WG_SERVER_ENABLED=true in production but WG_CLIENT_SERVER_PUBLIC_KEY is not set (required for user .conf and QR generation)');
    }
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

  // Abort on fatal errors. In production every collected error is fatal; outside
  // a dev/test sandbox the JWT-secret errors above are ALSO fatal (a non-prod
  // internet-exposed instance must not run with the forgeable default secret).
  if (errors.length > 0 && !allowInsecureSecret) {
    const message = 'Fatal configuration errors:\n  • ' + errors.join('\n  • ');
    throw new Error(message);
  }
}

config.validateEnv = validateEnv;

module.exports = config;
