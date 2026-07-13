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

  // Number of reverse-proxy hops in front of the app (Express `trust proxy`).
  // Without this, `req.ip` is the proxy's address for every client, which
  // collapses all per-IP rate limiting into ONE shared bucket — active users
  // exhaust it and get bounced to the login screen when /auth/refresh 429s.
  // Production deploys (docker-compose.prod, install.sh, host-nginx) all put
  // exactly one Nginx in front of the app, hence the production default of 1.
  // Set TRUST_PROXY to the real hop count for other topologies (e.g. 2 behind
  // an LB + Nginx); 0 disables (direct exposure, no proxy).
  trustProxy: parseIntEnv('TRUST_PROXY', (process.env.NODE_ENV || 'development') === 'production' ? 1 : 0),

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
    // Per-IP general API budget. The SPA fires dozens of calls per page view,
    // and office NATs put many staff behind one IP — 200 starved real usage.
    api: parseIntEnv('RATE_LIMIT_API', 1000),
    auth: parseIntEnv('RATE_LIMIT_AUTH', 20),
    // POST /auth/password-reset/request specifically (on top of the shared
    // `auth` bucket above, which already covers it by prefix). Once wired to
    // actually send email, this endpoint becomes a mail-bombing and
    // enumeration-timing vector distinct from login/register, so it gets its
    // own tighter per-IP budget rather than sharing the looser 20/window.
    passwordReset: parseIntEnv('RATE_LIMIT_PASSWORD_RESET', 5),
    // Session-keepalive endpoints (/auth/me, /auth/refresh, /auth/logout,
    // /auth/switch-organization) get their own per-IP bucket so a busy
    // dashboard can never starve its own session and force a re-login.
    session: parseIntEnv('RATE_LIMIT_SESSION', 240),
    public: parseIntEnv('RATE_LIMIT_PUBLIC', 60),
    upload: parseIntEnv('RATE_LIMIT_UPLOAD', 30),
    export: parseIntEnv('RATE_LIMIT_EXPORT', 20),
    sse: parseIntEnv('RATE_LIMIT_SSE', 10),
    webhook: parseIntEnv('RATE_LIMIT_WEBHOOK', 100),
    // POST /bulk/email only — a mass-send action reaching real client
    // inboxes, the same rationale passwordReset/verifyEmailResend already
    // get their own tighter per-IP budget on top of the shared `api` bucket.
    bulkEmail: parseIntEnv('RATE_LIMIT_BULK_EMAIL', 10),
    // Per-organization rolling-24h RECIPIENT-count budget for POST
    // /bulk/email (not a request count — one request already fans out to up
    // to 1000 recipients, so request-count alone under-protects against
    // mail-bombing). Enforced via cacheService, not express-rate-limit.
    bulkEmailDailyRecipients: parseIntEnv('RATE_LIMIT_BULK_EMAIL_DAILY_RECIPIENTS', 5000),
    // Per-tenant limits — apply to all authenticated/org-scoped requests
    tenantWindowMs: parseIntEnv('RATE_LIMIT_TENANT_WINDOW_MS', 15 * 60 * 1000),
    tenantApi: parseIntEnv('RATE_LIMIT_TENANT_API', 2000),
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
    serverEndpoint:   process.env.WG_ENDPOINT_HOST || process.env.DOMAIN || '', // public host NAS+clients dial; defaults to DOMAIN (the TLS host)
    serverListenPort: parseIntEnv('WG_LISTEN_PORT',        51820),
    serverPublicKey:  process.env.WG_SERVER_PUBLIC_KEY  || '',   // wg-fireisp public key (auto-generated on boot; pin only for an external key)
    serverSubnet:     process.env.WG_SERVER_SUBNET      || '10.255.0.0/16', // NAS peer pool
    keepalive:        parseIntEnv('WG_KEEPALIVE',           25),
    clientInterface:  process.env.WG_CLIENT_INTERFACE   || 'wg-clients',
    clientSubnet:     process.env.WG_CLIENT_SUBNET      || '10.99.0.0/16',  // user peer pool
    clientListenPort: parseIntEnv('WG_CLIENT_LISTEN_PORT', 51821),
    clientPublicKey:  process.env.WG_CLIENT_SERVER_PUBLIC_KEY || '', // wg-clients public key handed to users in .conf
    keyDir:           process.env.WG_KEY_DIR || '/etc/wireguard', // persistent dir for auto-generated server keypairs (mount a volume here)
  },

  // VoIP/RTC address-list auto-updater (voipRangesService). Refreshes the
  // fireisp-voip address-list on managed NAS from provider IP-range endpoints so
  // the §VoIP realtime-priority mangle keeps matching current RTC media servers.
  // Disabled by default — enable per deployment once realtime priority is seeded.
  voipRanges: {
    enabled:        parseBoolEnv('VOIP_RANGES_ENABLED', false),
    // Comma-separated source URLs; each returns CIDRs as plain lines or Google-style
    // JSON ({prefixes:[{ipv4Prefix}]}). Default = Zoom's published RTC ranges (Zoom is
    // a real-time-only service, so prioritising all of it is safe — unlike all-of-Meta/
    // Google, which over-match bulk traffic and are intentionally NOT defaulted).
    sourceUrls: (process.env.VOIP_RANGES_SOURCE_URLS || 'https://assets.zoom.us/docs/ipranges/Zoom.txt')
      .split(',').map((s) => s.trim()).filter(Boolean),
    maxEntries:     parseIntEnv('VOIP_RANGES_MAX_ENTRIES', 4000),
    fetchTimeoutMs: parseIntEnv('VOIP_RANGES_FETCH_TIMEOUT_MS', 10000),
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

  // WireGuard: the hub is ON by default in production. The endpoint auto-derives
  // from DOMAIN (the TLS host), and the server + client public keys are
  // auto-generated by the host bootstrap on first boot. So an unresolved endpoint
  // or unset keys are WARNINGS, not fatal — the hub still comes up; only the peer
  // configs it issues would lack a reachable server address until an endpoint is known.
  if (config.wireguard.serverEnabled && isProduction) {
    if (!config.wireguard.serverEndpoint) {
      warnings.push('WG_SERVER_ENABLED=true but no endpoint resolved (set WG_ENDPOINT_HOST, or DOMAIN) — issued NAS/user configs will lack a reachable server address');
    }
    if (!config.wireguard.serverPublicKey) {
      warnings.push('WG_SERVER_PUBLIC_KEY is not set — it will be auto-generated by the host bootstrap and persisted to WG_KEY_DIR (set only to pin an externally-managed key)');
    }
    if (!config.wireguard.clientPublicKey) {
      warnings.push('WG_CLIENT_SERVER_PUBLIC_KEY is not set — it will be auto-generated by the host bootstrap and persisted to WG_KEY_DIR (set only to pin an externally-managed key)');
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
