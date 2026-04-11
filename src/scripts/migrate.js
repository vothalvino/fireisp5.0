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

const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');

async function runMigrations() {
  // Migrations may contain multiple SQL statements per file, so we use a
  // dedicated connection with multipleStatements enabled (the main pool
  // intentionally disables this for security).
  const migrationPool = mysql.createPool({
    ...db.baseConnectionConfig,
    waitForConnections: true,
    connectionLimit: 1,
    multipleStatements: true,
  });

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
      console.log(`  Applying: ${file}`);

      try {
        await conn.query(sql);
        await conn.execute(
          'INSERT INTO schema_migrations (filename) VALUES (?)',
          [file],
        );
        count++;
      } catch (err) {
        console.error(`  ✗ Failed: ${file}`);
        console.error(`    ${err.message}`);
        throw err;
      }
    }

    if (count === 0) {
      console.log('  All migrations are up to date.');
    } else {
      console.log(`  ✓ Applied ${count} migration(s).`);
    }
  } finally {
    if (conn) conn.release();
    await migrationPool.end();
    await db.close();
  }
}

// Run when invoked directly
if (require.main === module) {
  console.log('FireISP 5.0 — Running migrations...');
  runMigrations()
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations };
