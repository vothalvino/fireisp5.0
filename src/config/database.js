// =============================================================================
// FireISP 5.0 — Database Connection Pool
// =============================================================================
// Creates and exports a mysql2/promise connection pool configured from
// environment variables. All application code should import `db` from here.
// =============================================================================

const mysql = require('mysql2/promise');
const { AsyncLocalStorage } = require('async_hooks');
const { recordDbQuery } = require('../utils/dbMetrics');
const { decrypt } = require('../utils/encryption');

const parseIntEnv = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

const parseBoolEnv = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
};

/**
 * Shared connection parameters derived from environment variables.
 * Used by both the main application pool and the migration runner.
 */
const baseConnectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fireisp',
  charset: 'utf8mb4',
  timezone: '+00:00',
};

const pool = mysql.createPool({
  ...baseConnectionConfig,
  waitForConnections: true,
  connectionLimit: parseIntEnv('DB_POOL_SIZE', 20),
  queueLimit: parseIntEnv('DB_QUEUE_LIMIT', 0),
  enableKeepAlive: true,
  keepAliveInitialDelay: parseIntEnv('DB_KEEP_ALIVE_MS', 30000),
});

const tenantContext = new AsyncLocalStorage();
const tenantConfigCache = new Map();
// tenantPoolCache: key -> { pool, lastUsed }. Entries are evicted on an idle TTL
// and capped with LRU eviction so multi-tenant deployments with many orgs do not
// accumulate connection pools indefinitely.
const tenantPoolCache = new Map();
const TENANT_CACHE_TTL_MS = parseIntEnv('TENANT_DB_CONFIG_CACHE_MS', 60000);
// Close a tenant pool after it has been idle for this long (0 disables idle eviction).
const TENANT_POOL_IDLE_MS = parseIntEnv('TENANT_DB_POOL_IDLE_MS', 300000);
// Maximum number of tenant pools to keep cached before LRU-evicting the oldest.
const TENANT_POOL_MAX = Math.max(1, parseIntEnv('TENANT_DB_POOL_MAX', 100));

/**
 * Read replica pool — created only when DB_REPLICA_HOST is set.
 * Falls back to the primary pool when no replica is configured so that
 * `queryReplica` works transparently in single-server deployments.
 */
const replicaPool = process.env.DB_REPLICA_HOST
  ? mysql.createPool({
    host: process.env.DB_REPLICA_HOST,
    port: parseInt(process.env.DB_REPLICA_PORT || '3306', 10),
    user: process.env.DB_REPLICA_USER || process.env.DB_USER || 'root',
    password: process.env.DB_REPLICA_PASSWORD !== undefined
      ? process.env.DB_REPLICA_PASSWORD
      : (process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME || 'fireisp',
    charset: 'utf8mb4',
    timezone: '+00:00',
    waitForConnections: true,
    connectionLimit: parseIntEnv('DB_REPLICA_POOL_SIZE', 10),
    queueLimit: parseIntEnv('DB_QUEUE_LIMIT', 0),
    enableKeepAlive: true,
    keepAliveInitialDelay: parseIntEnv('DB_KEEP_ALIVE_MS', 30000),
  })
  : null;

function withTenantContext(orgId, callback) {
  return tenantContext.run({ orgId }, callback);
}

function normalizeTenantConfig(row) {
  if (!row || row.isolation_mode !== 'isolated') return null;
  if (!row.db_host || !row.db_name || !row.db_user) {
    throw new Error(`Tenant ${row.organization_id} has incomplete isolated database configuration`);
  }
  return {
    host: row.db_host,
    port: row.db_port || 3306,
    user: row.db_user,
    password: decrypt(row.db_password_encrypted) || '',
    database: row.db_name,
    ssl: row.ssl_enabled
      ? { rejectUnauthorized: parseBoolEnv('TENANT_DB_SSL_REJECT_UNAUTHORIZED', true) }
      : undefined,
  };
}

async function getTenantConnectionConfig(orgId) {
  if (!orgId) return null;
  const key = String(orgId);
  const cached = tenantConfigCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [rows] = await pool.execute(
    `SELECT organization_id, isolation_mode, db_host, db_port, db_name, db_user,
            db_password_encrypted, ssl_enabled
       FROM organization_database_configs
      WHERE organization_id = ?`,
    [orgId],
  );
  const value = normalizeTenantConfig(rows[0]);
  tenantConfigCache.set(key, { value, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
  return value;
}

/**
 * Close and remove a single tenant pool from the cache.
 * Pool shutdown errors are swallowed so eviction never rejects the caller.
 */
function evictTenantPool(key, entry) {
  tenantPoolCache.delete(key);
  Promise.resolve()
    .then(() => entry.pool.end())
    .catch(() => {});
}

/**
 * Close any tenant pools that have been idle longer than TENANT_POOL_IDLE_MS.
 */
function evictIdleTenantPools(now = Date.now()) {
  if (TENANT_POOL_IDLE_MS <= 0) return;
  for (const [key, entry] of tenantPoolCache) {
    if (now - entry.lastUsed > TENANT_POOL_IDLE_MS) evictTenantPool(key, entry);
  }
}

async function getTenantPool(orgId) {
  const config = await getTenantConnectionConfig(orgId);
  if (!config) return null;

  const key = String(orgId);
  const now = Date.now();
  evictIdleTenantPools(now);

  let entry = tenantPoolCache.get(key);
  if (entry) {
    // Refresh LRU recency by re-inserting at the end of the Map.
    tenantPoolCache.delete(key);
  } else {
    entry = {
      pool: mysql.createPool({
        ...config,
        charset: 'utf8mb4',
        timezone: '+00:00',
        waitForConnections: true,
        connectionLimit: parseIntEnv('TENANT_DB_POOL_SIZE', 10),
        queueLimit: parseIntEnv('DB_QUEUE_LIMIT', 0),
        enableKeepAlive: true,
        keepAliveInitialDelay: parseIntEnv('DB_KEEP_ALIVE_MS', 30000),
      }),
      lastUsed: now,
    };
  }
  entry.lastUsed = now;
  tenantPoolCache.set(key, entry);

  // Enforce the LRU cap by evicting the least-recently-used pools.
  while (tenantPoolCache.size > TENANT_POOL_MAX) {
    const oldestKey = tenantPoolCache.keys().next().value;
    if (oldestKey === key) break;
    evictTenantPool(oldestKey, tenantPoolCache.get(oldestKey));
  }

  return entry.pool;
}

async function getCurrentPool({ preferReplica = false } = {}) {
  const store = tenantContext.getStore();
  if (store?.orgId) {
    const tenantPool = await getTenantPool(store.orgId);
    if (tenantPool) return tenantPool;
  }
  return preferReplica ? (replicaPool || pool) : pool;
}

async function invalidateTenantDbConfig(orgId) {
  const key = String(orgId);
  tenantConfigCache.delete(key);
  const entry = tenantPoolCache.get(key);
  tenantPoolCache.delete(key);
  if (entry) await entry.pool.end();
}

async function testTenantConnection(connectionConfig) {
  const testPool = mysql.createPool({
    ...baseConnectionConfig,
    ...connectionConfig,
    password: connectionConfig.password || '',
    charset: 'utf8mb4',
    timezone: '+00:00',
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
  });
  try {
    await testPool.execute('SELECT 1');
    return true;
  } finally {
    await testPool.end();
  }
}

/**
 * Run a query and return [rows, fields].
 * Records DB query duration into the Prometheus histogram.
 */
async function query(sql, params) {
  const targetPool = await getCurrentPool();
  const start = process.hrtime.bigint();
  try {
    return await targetPool.execute(sql, params);
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const op = /^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE)/i.exec(sql);
    recordDbQuery(durationSeconds, op ? op[1].toUpperCase() : 'OTHER');
  }
}

/**
 * Run a read-only SELECT query against the replica pool.
 * Falls back to the primary pool when no replica is configured.
 * Use this for all report and dashboard queries.
 */
async function queryReplica(sql, params) {
  const targetPool = await getCurrentPool({ preferReplica: true });
  const start = process.hrtime.bigint();
  try {
    return await targetPool.execute(sql, params);
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    recordDbQuery(durationSeconds, 'SELECT');
  }
}

/**
 * Get a single connection from the pool (for transactions).
 */
async function getConnection() {
  const targetPool = await getCurrentPool();
  return targetPool.getConnection();
}

/**
 * Close the pool (for graceful shutdown).
 */
async function close() {
  const tasks = [pool.end()];
  if (replicaPool) tasks.push(replicaPool.end());
  for (const entry of tenantPoolCache.values()) tasks.push(entry.pool.end());
  tenantPoolCache.clear();
  tenantConfigCache.clear();
  // Use allSettled so that a single pool failing to close does not prevent the
  // remaining pools from being drained during graceful shutdown.
  await Promise.allSettled(tasks);
}

module.exports = {
  pool,
  replicaPool,
  query,
  queryReplica,
  getConnection,
  close,
  baseConnectionConfig,
  withTenantContext,
  getTenantConnectionConfig,
  invalidateTenantDbConfig,
  testTenantConnection,
};
