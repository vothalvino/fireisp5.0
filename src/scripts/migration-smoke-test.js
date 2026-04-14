// =============================================================================
// FireISP 5.0 — Migration Smoke Test
// =============================================================================
// Validates that all migrations were applied successfully against an empty
// MySQL 8 database and that the resulting schema matches schema.sql.
//
// Prerequisites: run `node src/scripts/migrate.js` first so that the database
//                already contains the migrated schema.
//
// Usage:  node src/scripts/migration-smoke-test.js
//         npm run migrate:smoke-test   (runs migrate.js first, then this)
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../utils/logger').child({ script: 'migration-smoke-test' });

const SCHEMA_SQL = path.resolve(__dirname, '../../database/schema.sql');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');

/**
 * Extract table names from CREATE TABLE statements in a SQL file.
 */
function extractTableNames(sqlContent) {
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi;
  const tables = new Set();
  let match;
  while ((match = regex.exec(sqlContent)) !== null) {
    tables.add(match[1].toLowerCase());
  }
  return tables;
}

async function runSmokeTest() {
  // -------------------------------------------------------------------------
  // 1. Verify all migration files were applied (recorded in schema_migrations)
  // -------------------------------------------------------------------------
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const [applied] = await db.query('SELECT filename FROM schema_migrations ORDER BY id');
  const appliedSet = new Set(applied.map(r => r.filename));

  const unapplied = migrationFiles.filter(f => !appliedSet.has(f));
  if (unapplied.length > 0) {
    logger.error({ unapplied }, 'Migrations not applied');
    return false;
  }

  logger.info(
    { expected: migrationFiles.length, applied: appliedSet.size },
    'All migration files recorded in schema_migrations',
  );

  // -------------------------------------------------------------------------
  // 2. Compare migrated table names against schema.sql
  // -------------------------------------------------------------------------
  const dbName = process.env.DB_NAME || 'fireisp';

  const [rows] = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
    [dbName],
  );
  const migratedTables = new Set(
    rows.map(r => (r.TABLE_NAME || r.table_name).toLowerCase()),
  );

  const schemaSql = fs.readFileSync(SCHEMA_SQL, 'utf8');
  const expectedTables = extractTableNames(schemaSql);

  const missingFromMigrations = [...expectedTables].filter(
    t => !migratedTables.has(t),
  );
  const extraInMigrations = [...migratedTables].filter(
    t => !expectedTables.has(t) && t !== 'schema_migrations',
  );

  let passed = true;

  if (missingFromMigrations.length > 0) {
    logger.error(
      { tables: missingFromMigrations },
      'Tables declared in schema.sql but missing after migrations',
    );
    passed = false;
  }

  if (extraInMigrations.length > 0) {
    logger.warn(
      { tables: extraInMigrations },
      'Tables created by migrations but not declared in schema.sql',
    );
    // Extra tables are a warning, not a failure — migrations may add
    // auxiliary tables (e.g. FreeRADIUS dictionary tables).
  }

  logger.info(
    {
      migratedTableCount: migratedTables.size,
      schemaTableCount: expectedTables.size,
      missingCount: missingFromMigrations.length,
      extraCount: extraInMigrations.length,
    },
    'Schema comparison complete',
  );

  return passed;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
if (require.main === module) {
  logger.info('FireISP 5.0 — Migration smoke test');
  runSmokeTest()
    .then(async passed => {
      await db.close();
      if (passed) {
        logger.info('Migration smoke test PASSED');
        process.exit(0);
      } else {
        logger.error('Migration smoke test FAILED');
        process.exit(1);
      }
    })
    .catch(async err => {
      logger.error({ err }, 'Migration smoke test error');
      await db.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { runSmokeTest, extractTableNames };
