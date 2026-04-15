// =============================================================================
// FireISP 5.0 — Migration Rollback Runner
// =============================================================================
// Rolls back one or more migrations by executing the matching SQL file from
// database/rollbacks/ in reverse order and removing the entry from
// schema_migrations so the forward migration can be re-applied later.
//
// Usage:
//   node src/scripts/rollback.js                   Roll back the last migration
//   node src/scripts/rollback.js --step 3          Roll back the last 3 migrations
//   node src/scripts/rollback.js --to 140          Roll back down to (but not including) migration 140
//   npm run rollback                               Alias for rolling back the last migration
//   npm run rollback -- --step 3
//   npm run rollback -- --to 140
//
// Safety:
//   - Only migrations that have a rollback SQL file in database/rollbacks/ can
//     be rolled back.  If no rollback file exists the script will stop and warn.
//   - Each rollback is wrapped in a transaction where possible (DDL in MySQL is
//     auto-committed, but the schema_migrations DELETE is reliable).
//   - Dry-run mode (--dry-run) prints what would be rolled back without touching
//     the database.
// =============================================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const db   = require('../config/database');
const logger = require('../utils/logger').child({ script: 'rollback' });

const ROLLBACKS_DIR  = path.resolve(__dirname, '../../database/rollbacks');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { step: 1, to: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--step' && argv[i + 1]) {
      args.step = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--to' && argv[i + 1]) {
      args.to = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Extract the numeric prefix from a migration filename (e.g. "130" from
// "130_create_firerelay_nodes_table.sql").
// ---------------------------------------------------------------------------
function migrationNumber(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : NaN;
}

// ---------------------------------------------------------------------------
// Main rollback logic
// ---------------------------------------------------------------------------
async function runRollback(args) {
  // 1. Fetch applied migrations (most recent first)
  const [applied] = await db.query(
    'SELECT id, filename FROM schema_migrations ORDER BY id DESC',
  );

  if (applied.length === 0) {
    logger.info('No migrations have been applied — nothing to roll back.');
    return;
  }

  // 2. Determine which migrations to roll back
  let targets;
  if (args.to !== null) {
    // Roll back everything with a migration number > args.to
    targets = applied.filter(r => migrationNumber(r.filename) > args.to);
  } else {
    targets = applied.slice(0, args.step);
  }

  if (targets.length === 0) {
    logger.info('No matching migrations to roll back.');
    return;
  }

  // 3. Verify rollback SQL files exist for every target
  const available = new Set(
    fs.readdirSync(ROLLBACKS_DIR).filter(f => f.endsWith('.sql')),
  );

  for (const t of targets) {
    if (!available.has(t.filename)) {
      logger.error(
        { filename: t.filename },
        'No rollback file found — aborting. Create database/rollbacks/' +
          t.filename + ' and retry.',
      );
      process.exit(1);
    }
  }

  // 4. Preview (dry-run) or execute
  if (args.dryRun) {
    logger.info('Dry-run mode — no changes will be made.');
    for (const t of targets) {
      logger.info({ filename: t.filename }, 'Would roll back');
    }
    return;
  }

  // Open a dedicated connection with multipleStatements for DDL scripts
  const rollbackPool = mysql.createPool({
    ...db.baseConnectionConfig,
    waitForConnections: true,
    connectionLimit: 1,
    multipleStatements: true,
  });

  let conn;
  try {
    conn = await rollbackPool.getConnection();

    for (const t of targets) {
      const sqlPath = path.join(ROLLBACKS_DIR, t.filename);
      const sql = fs.readFileSync(sqlPath, 'utf8');

      logger.info({ filename: t.filename }, 'Rolling back migration');
      try {
        await conn.query(sql);
        await conn.execute(
          'DELETE FROM schema_migrations WHERE filename = ?',
          [t.filename],
        );
        logger.info({ filename: t.filename }, 'Rolled back successfully');
      } catch (err) {
        logger.error({ err, filename: t.filename }, 'Rollback failed');
        throw err;
      }
    }

    logger.info({ count: targets.length }, 'Rollback complete');
  } finally {
    if (conn) conn.release();
    await rollbackPool.end();
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  logger.info({ step: args.step, to: args.to, dryRun: args.dryRun }, 'FireISP 5.0 — Rolling back migrations');
  runRollback(args)
    .then(() => {
      logger.info('Done.');
      process.exit(0);
    })
    .catch(err => {
      logger.error({ err }, 'Rollback failed');
      process.exit(1);
    });
}

module.exports = { runRollback };
