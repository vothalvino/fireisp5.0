// =============================================================================
// FireISP 5.0 — Migration Runner
// =============================================================================
// Reads each numbered .sql file in database/migrations/ and applies it if not
// already recorded in schema_migrations.
//
// Usage:  node src/scripts/migrate.js
//         npm run migrate
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const db = require('../config/database');
const logger = require('../utils/logger').child({ script: 'migrate' });
const { listIsolatedMigrationTargets } = require('../services/tenantDatabaseService');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');

function parseBoolEnv(key, fallback = false) {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

/**
 * Split a SQL migration file into individual executable statements.
 *
 * Handles `DELIMITER $$` / `DELIMITER ;` directives that are understood by the
 * mysql CLI client but rejected by mysql2's prepared-statement protocol.  The
 * function tracks the current delimiter and emits one statement string per
 * delimiter occurrence so callers can execute them one by one via conn.query().
 *
 * @param {string} sql - Raw file content of a .sql migration file.
 * @returns {string[]} Array of non-empty SQL statement strings (no trailing delimiter).
 */
function splitStatements(sql) {
  const statements = [];
  let delimiter = ';';
  let current = '';

  // Process line by line so DELIMITER directives are easy to detect at line start.
  for (const rawLine of sql.split('\n')) {
    const trimmed = rawLine.trim();

    // DELIMITER directive: switch the current statement terminator.
    const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)\s*$/i);
    if (delimMatch) {
      // Flush any accumulated text before the directive change.
      const pending = current.trim();
      if (pending) {
        statements.push(pending);
        current = '';
      }
      delimiter = delimMatch[1];
      continue;
    }

    current += rawLine + '\n';

    // Check if the accumulated buffer ends with the current delimiter.
    // We compare against the trimmed tail of the buffer to ignore trailing
    // whitespace / newlines after the delimiter token.
    const trimmedCurrent = current.trimEnd();
    if (trimmedCurrent.endsWith(delimiter)) {
      // Strip the trailing delimiter before pushing.
      const stmt = trimmedCurrent.slice(0, trimmedCurrent.length - delimiter.length).trim();
      if (stmt) {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Flush any remaining content (e.g. files that don't end with a delimiter).
  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

function createMigrationPool(connectionConfig) {
  // Migrations may contain multiple SQL statements per file, so we use a
  // dedicated connection with multipleStatements enabled (the main pool
  // intentionally disables this for security).
  return mysql.createPool({
    ...connectionConfig,
    waitForConnections: true,
    connectionLimit: 1,
    multipleStatements: true,
  });
}

async function applyMigrations(migrationPool, label = 'primary') {

  let conn;
  try {
    conn = await migrationPool.getConnection();

    // Ensure schema_migrations table exists (migration 052 creates it, but
    // we need it before running any migrations on a fresh DB).
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
        filename   VARCHAR(255)     NOT NULL,
        applied_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_schema_migrations_filename (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Fetch already-applied filenames
    const [applied] = await conn.execute('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.map(r => r.filename));

    // Read migration files sorted by filename (numeric prefix ensures order)
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      logger.info({ file, target: label }, 'Applying migration');

      try {
        for (const stmt of splitStatements(sql)) {
          await conn.query(stmt);
        }
        await conn.execute(
          'INSERT INTO schema_migrations (filename) VALUES (?)',
          [file],
        );
        count++;
      } catch (err) {
        logger.error({ err, file }, 'Migration failed');
        throw err;
      }
    }

    if (count === 0) {
      logger.info({ target: label }, 'All migrations are up to date.');
    } else {
      logger.info({ count, target: label }, 'Migrations applied');
    }
  } finally {
    if (conn) conn.release();
  }
}

async function runMigrations(options = {}) {
  const includeIsolatedTenants = options.includeIsolatedTenants
    ?? parseBoolEnv('MIGRATE_ISOLATED_TENANTS', false);
  const primaryPool = createMigrationPool(db.baseConnectionConfig);

  try {
    try {
      await applyMigrations(primaryPool, db.baseConnectionConfig.database);
    } finally {
      await primaryPool.end();
    }

    if (includeIsolatedTenants) {
      const targets = await listIsolatedMigrationTargets();
      for (const target of targets) {
        const tenantPool = createMigrationPool(target.connectionConfig);
        try {
          await applyMigrations(tenantPool, `org:${target.organizationId}:${target.database}`);
        } finally {
          await tenantPool.end();
        }
      }
    }
  } finally {
    await db.close();
  }
}

// Run when invoked directly
if (require.main === module) {
  logger.info('FireISP 5.0 — Running migrations...');
  runMigrations()
    .then(() => {
      logger.info('Done.');
      process.exit(0);
    })
    .catch(err => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}

module.exports = { runMigrations, splitStatements, createMigrationPool, applyMigrations };
