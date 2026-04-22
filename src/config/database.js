// =============================================================================
// FireISP 5.0 — Database Connection Pool
// =============================================================================
// Creates and exports a mysql2/promise connection pool configured from
// environment variables. All application code should import `db` from here.
// =============================================================================

const mysql = require('mysql2/promise');
const { recordDbQuery } = require('../utils/dbMetrics');

const parseIntEnv = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
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

/**
 * Run a query and return [rows, fields].
 * Records DB query duration into the Prometheus histogram.
 */
async function query(sql, params) {
  const start = process.hrtime.bigint();
  try {
    return await pool.execute(sql, params);
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const op = /^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE)/i.exec(sql);
    recordDbQuery(durationSeconds, op ? op[1].toUpperCase() : 'OTHER');
  }
}

/**
 * Get a single connection from the pool (for transactions).
 */
async function getConnection() {
  return pool.getConnection();
}

/**
 * Close the pool (for graceful shutdown).
 */
async function close() {
  return pool.end();
}

module.exports = { pool, query, getConnection, close, baseConnectionConfig };
