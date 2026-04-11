// =============================================================================
// FireISP 5.0 — Database Connection Pool
// =============================================================================
// Creates and exports a mysql2/promise connection pool configured from
// environment variables. All application code should import `db` from here.
// =============================================================================

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fireisp',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00',
  multipleStatements: true,
});

/**
 * Run a query and return [rows, fields].
 */
async function query(sql, params) {
  return pool.execute(sql, params);
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

module.exports = { pool, query, getConnection, close };
