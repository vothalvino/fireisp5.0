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
//   MIGRATE_ISOLATED_TENANTS=true npm run rollback -- --step 1
//
// Safety:
//   - Only migrations that have a rollback SQL file in database/rollbacks/ can
//     be rolled back.  If no rollback file exists the script will stop and warn.
//   - MySQL DDL auto-commits. A failed rollback can therefore leave a database
//     partially changed and must be repaired before retrying.
//   - Dry-run mode (--dry-run) prints what would be rolled back without touching
//     the database.
//   - MIGRATE_ISOLATED_TENANTS=true applies the same request to the primary and
//     every configured isolated database. Each database calculates its targets
//     from its own schema_migrations history.
//   - Step mode is accepted across multiple databases only when every preflight
//     resolves the exact same migration filenames. When histories differ, use
//     an explicit --to boundary so a lagging tenant cannot lose an unrelated
//     migration merely because it is locally "latest".
// =============================================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const db   = require('../config/database');
const logger = require('../utils/logger').child({ script: 'rollback' });
const { splitStatements } = require('./migrate');
const { listIsolatedMigrationTargets } = require('../services/tenantDatabaseService');

const ROLLBACKS_DIR  = path.resolve(__dirname, '../../database/rollbacks');

function parseBoolEnv(key, fallback = false) {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

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

function createRollbackPool(connectionConfig) {
  return mysql.createPool({
    ...connectionConfig,
    waitForConnections: true,
    connectionLimit: 1,
    multipleStatements: true,
  });
}

function indexRollbackFiles() {
  const byPrefix = new Map();
  for (const filename of fs.readdirSync(ROLLBACKS_DIR).filter(file => file.endsWith('.sql'))) {
    const number = migrationNumber(filename);
    if (Number.isNaN(number)) continue;
    if (byPrefix.has(number)) {
      const existing = byPrefix.get(number);
      throw new Error(
        `Two rollback files share migration prefix ${number}: ${existing}, ${filename}`,
      );
    }
    byPrefix.set(number, filename);
  }
  return byPrefix;
}

function buildRollbackPlan(applied, args, rollbackFilesByPrefix, label) {
  // Do not assume a driver or test double retained the ORDER BY. Rollbacks must
  // always execute newest-first within each database.
  const ordered = [...applied].sort((a, b) => Number(b.id) - Number(a.id));
  const targets = args.to !== null
    ? ordered.filter(row => migrationNumber(row.filename) > args.to)
    : ordered.slice(0, args.step);

  return {
    label,
    targets: targets.map(target => {
      const rollbackFile = rollbackFilesByPrefix.get(migrationNumber(target.filename));
      if (!rollbackFile) {
        throw new Error(
          `No rollback file found for ${target.filename} on ${label}. ` +
          'Create a database/rollbacks/ file with the same numeric prefix and retry.',
        );
      }
      return { ...target, rollbackFile };
    }),
  };
}

function assertConsistentStepPlans(plans, args, includeIsolatedTenants) {
  if (!includeIsolatedTenants || args.to !== null || plans.length < 2) return;
  const expected = plans[0].targets.map(target => target.filename);
  for (const plan of plans.slice(1)) {
    const actual = plan.targets.map(target => target.filename);
    if (actual.length !== expected.length
        || actual.some((filename, index) => filename !== expected[index])) {
      throw new Error(
        'Step-based rollback targets differ across databases. No changes were made. ' +
        'Re-run the dry-run with an explicit --to <migration> boundary.',
      );
    }
  }
}

async function withRollbackPool(connectionConfig, operation) {
  const pool = createRollbackPool(connectionConfig);
  let operationError = null;
  let result;
  try {
    result = await operation(pool);
  } catch (err) {
    operationError = err;
  }

  try {
    await pool.end();
  } catch (cleanupError) {
    if (!operationError) operationError = cleanupError;
    else logger.error({ err: cleanupError }, 'Failed to close rollback database pool');
  }

  if (operationError) throw operationError;
  return result;
}

async function inspectRollbackTarget(target, args, rollbackFilesByPrefix) {
  return withRollbackPool(target.connectionConfig, async pool => {
    let conn;
    try {
      conn = await pool.getConnection();
      const [applied] = await conn.execute(
        'SELECT id, filename FROM schema_migrations ORDER BY id DESC',
      );
      return buildRollbackPlan(applied, args, rollbackFilesByPrefix, target.label);
    } finally {
      if (conn) conn.release();
    }
  });
}

async function executeRollbackPlan(target, plan) {
  if (plan.targets.length === 0) return 0;

  return withRollbackPool(target.connectionConfig, async pool => {
    let conn;
    try {
      conn = await pool.getConnection();
      logger.warn(
        { target: target.label, count: plan.targets.length },
        'DESTRUCTIVE: starting schema rollback; MySQL DDL may auto-commit',
      );

      for (const migration of plan.targets) {
        const sqlPath = path.join(ROLLBACKS_DIR, migration.rollbackFile);
        const sql = fs.readFileSync(sqlPath, 'utf8');

        logger.info(
          {
            target: target.label,
            filename: migration.filename,
            rollbackFile: migration.rollbackFile,
          },
          'Rolling back migration',
        );
        try {
          // Use the same DELIMITER-aware splitter as migrate.js — rollback files
          // contain stored-procedure blocks that mysql2 cannot execute verbatim.
          for (const stmt of splitStatements(sql)) {
            await conn.query(stmt);
          }
          await conn.execute(
            'DELETE FROM schema_migrations WHERE filename = ?',
            [migration.filename],
          );
          logger.info(
            { target: target.label, filename: migration.filename },
            'Rolled back successfully',
          );
        } catch (err) {
          logger.error(
            { err, target: target.label, filename: migration.filename },
            'Rollback failed; this database may require manual repair before retrying',
          );
          throw err;
        }
      }

      logger.info(
        { target: target.label, count: plan.targets.length },
        'Database rollback complete',
      );
      return plan.targets.length;
    } finally {
      if (conn) conn.release();
    }
  });
}

// ---------------------------------------------------------------------------
// Main rollback logic
// ---------------------------------------------------------------------------
async function performRollback(args, includeIsolatedTenants) {
  // Resolve isolated connection details before changing the primary schema;
  // a rollback may itself remove or alter the isolation configuration table.
  const isolatedTargets = includeIsolatedTenants
    ? await listIsolatedMigrationTargets()
    : [];
  const targets = [
    {
      label: db.baseConnectionConfig.database || 'primary',
      connectionConfig: db.baseConnectionConfig,
    },
    ...isolatedTargets.map(target => ({
      label: `org:${target.organizationId}:${target.database}`,
      connectionConfig: target.connectionConfig,
    })),
  ];

  if (includeIsolatedTenants) {
    logger.warn(
      { databaseCount: targets.length, isolatedDatabaseCount: isolatedTargets.length },
      'Isolated-tenant rollback enabled; every database uses its own migration history',
    );
  }

  // Preflight every database before making any destructive change. This both
  // calculates targets independently and prevents a missing rollback file or
  // unreachable tenant database from being discovered after primary DDL ran.
  const rollbackFilesByPrefix = indexRollbackFiles();
  const plans = [];
  for (const target of targets) {
    try {
      plans.push(await inspectRollbackTarget(target, args, rollbackFilesByPrefix));
    } catch (err) {
      logger.error({ err, target: target.label }, 'Rollback preflight failed; no changes were made');
      throw err;
    }
  }
  assertConsistentStepPlans(plans, args, includeIsolatedTenants);

  if (args.dryRun) {
    logger.info('Dry-run mode — no changes will be made.');
    for (const plan of plans) {
      if (plan.targets.length === 0) {
        logger.info({ target: plan.label }, 'No matching migrations to roll back');
      }
      for (const migration of plan.targets) {
        logger.info(
          { target: plan.label, filename: migration.filename },
          'Would roll back',
        );
      }
    }
    return;
  }

  const migrationCount = plans.reduce((sum, plan) => sum + plan.targets.length, 0);
  if (migrationCount === 0) {
    logger.info('No matching migrations to roll back.');
    return;
  }

  logger.warn(
    { databaseCount: targets.length, migrationCount },
    'DESTRUCTIVE OPERATION: MySQL DDL auto-commits; a failure can leave a partial rollback',
  );

  let completed = 0;
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    try {
      completed += await executeRollbackPlan(target, plans[index]);
    } catch (err) {
      logger.error(
        { err, target: target.label, completed },
        'Rollback run stopped; remaining databases were not changed',
      );
      throw err;
    }
  }

  logger.info(
    { databaseCount: targets.length, count: completed },
    'Rollback complete',
  );
}

async function runRollback(inputArgs, options = {}) {
  const args = { step: 1, to: null, dryRun: false, ...inputArgs };
  const includeIsolatedTenants = options.includeIsolatedTenants
    ?? parseBoolEnv('MIGRATE_ISOLATED_TENANTS', false);
  let runError = null;
  let result;

  try {
    result = await performRollback(args, includeIsolatedTenants);
  } catch (err) {
    runError = err;
  }

  try {
    await db.close();
  } catch (cleanupError) {
    if (!runError) runError = cleanupError;
    else logger.error({ err: cleanupError }, 'Failed to close primary database pool after rollback error');
  }

  if (runError) throw runError;
  return result;
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

module.exports = {
  runRollback,
  buildRollbackPlan,
  assertConsistentStepPlans,
  createRollbackPool,
  parseArgs,
};
