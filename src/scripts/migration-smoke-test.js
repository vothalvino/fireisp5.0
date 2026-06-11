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

/**
 * Extract column names per table from CREATE TABLE blocks in a SQL file.
 *
 * Returns a Map<tableName, Set<columnName>>.
 *
 * The parser walks the file line by line, tracking paren depth so it can tell
 * which lines are at the top level of a CREATE TABLE body (depth 1). Lines at
 * depth > 1 are inside sub-expressions (ENUM values, inline expressions, etc.)
 * and are skipped. At depth 1, KEY / CONSTRAINT / closing-paren lines are also
 * skipped; everything else is treated as the start of a column definition and
 * the first identifier on the line is recorded as the column name.
 */
function extractSchemaColumns(sqlContent) {
  const result = new Map();
  const lines = sqlContent.split('\n');
  let currentTable = null;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (currentTable === null) {
      const m = trimmed.match(
        /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/i,
      );
      if (m) {
        currentTable = m[1].toLowerCase();
        result.set(currentTable, new Set());
        // Count any parens that appear on the CREATE TABLE line itself
        for (const ch of line) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
      }
      continue;
    }

    // We are inside a CREATE TABLE block.
    // Record depth BEFORE processing this line so we know where the line starts.
    const depthBefore = depth;
    for (const ch of line) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }

    // If depth dropped to 0 the table body just closed — stop.
    if (depth === 0) {
      currentTable = null;
      continue;
    }

    // Only examine lines that begin at the top level of the table body (depth 1).
    if (depthBefore !== 1) continue;

    // Skip blank lines and SQL comments.
    if (!trimmed || trimmed.startsWith('--')) continue;

    // Skip index / FK / constraint lines (including table-level CHECK constraints).
    if (/^(PRIMARY\s+KEY|UNIQUE\s+KEY|KEY\s|INDEX\s|SPATIAL\s+KEY|FULLTEXT\s|CONSTRAINT\s|FOREIGN\s+KEY|CHECK\s*\()/i.test(trimmed)) continue;

    // Skip lines that are continuations of a previous column definition:
    // closing paren, quoted strings (ENUM values), or continuation keywords.
    // A continuation COMMENT is always followed by a string literal — a line
    // like "comment TEXT NULL ..." is a column actually named comment and
    // must NOT be skipped.
    if (/^[)'"]/.test(trimmed)) continue;
    if (/^(COMMENT\s+'|NOT\s+NULL|NULL\b|DEFAULT\s|REFERENCES\s|AFTER\s|ON\s+DELETE|ON\s+UPDATE|COLLATE\s)/i.test(trimmed)) continue;

    // First identifier on the line is the column name.
    const colM = trimmed.match(/^`?(\w+)`?/);
    if (colM) {
      result.get(currentTable).add(colM[1].toLowerCase());
    }
  }

  return result;
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

  // -------------------------------------------------------------------------
  // 3. Column-level comparison — detect columns added by migrations that were
  //    not backfilled into schema.sql (the most common sync oversight).
  // -------------------------------------------------------------------------
  const [colRows] = await db.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = ?
     ORDER BY table_name, ordinal_position`,
    [dbName],
  );

  // Map of tableName -> Set<columnName> from the live migrated database.
  const dbCols = new Map();
  for (const row of colRows) {
    const tbl = (row.TABLE_NAME || row.table_name).toLowerCase();
    const col = (row.COLUMN_NAME || row.column_name).toLowerCase();
    if (!dbCols.has(tbl)) dbCols.set(tbl, new Set());
    dbCols.get(tbl).add(col);
  }

  // Map of tableName -> Set<columnName> parsed from schema.sql CREATE TABLE blocks.
  const schemaColMap = extractSchemaColumns(schemaSql);

  // Report columns present in the migrated DB but absent from schema.sql.
  // This is the primary failure mode: a migration adds a column but schema.sql
  // is not updated.
  const colsMissingFromSchema = [];
  for (const [tbl, cols] of dbCols) {
    if (tbl === 'schema_migrations') continue;
    const schemaCols = schemaColMap.get(tbl);
    if (!schemaCols) continue; // table not in schema.sql — reported above
    for (const col of cols) {
      if (!schemaCols.has(col)) {
        colsMissingFromSchema.push(`${tbl}.${col}`);
      }
    }
  }

  if (colsMissingFromSchema.length > 0) {
    logger.error(
      { columns: colsMissingFromSchema },
      'Columns exist in migrated DB but are missing from schema.sql — update schema.sql to include these columns',
    );
    passed = false;
  }

  // Report columns declared in schema.sql but absent from the migrated DB.
  // This is less common but indicates schema.sql has drifted ahead of migrations.
  const colsMissingFromDb = [];
  for (const [tbl, cols] of schemaColMap) {
    const dbTableCols = dbCols.get(tbl);
    if (!dbTableCols) continue; // table not in DB — reported above
    for (const col of cols) {
      if (!dbTableCols.has(col)) {
        colsMissingFromDb.push(`${tbl}.${col}`);
      }
    }
  }

  if (colsMissingFromDb.length > 0) {
    logger.warn(
      { columns: colsMissingFromDb },
      'Columns declared in schema.sql but missing from migrated DB — a migration may be needed',
    );
    // Warning only: schema.sql may declare columns that are intentionally
    // added via ALTER TABLE migrations that haven't run yet in some setups.
  }

  const totalDbCols = [...dbCols.values()].reduce((s, c) => s + c.size, 0);
  const totalSchemaCols = [...schemaColMap.values()].reduce((s, c) => s + c.size, 0);
  logger.info(
    {
      dbColumnCount: totalDbCols,
      schemaColumnCount: totalSchemaCols,
      missingFromSchemaCount: colsMissingFromSchema.length,
      missingFromDbCount: colsMissingFromDb.length,
    },
    'Column-level comparison complete',
  );

  // -------------------------------------------------------------------------
  // 4. Partition capacity check — every RANGE-partitioned table must have a
  //    named partition whose upper bound is in the future, i.e. current rows
  //    must not be landing in the catch-all p_future partition. Guards
  //    against the hardcoded-partition ceiling regressing (migrations
  //    025/032; maintenance fixed in 248).
  // -------------------------------------------------------------------------
  const [partRows] = await db.query(
    `SELECT table_name,
            MAX(CAST(partition_description AS UNSIGNED)) AS max_bound
     FROM information_schema.partitions
     WHERE table_schema = ?
       AND partition_method = 'RANGE'
       AND partition_name IS NOT NULL
       AND partition_description != 'MAXVALUE'
     GROUP BY table_name`,
    [dbName],
  );

  const nowTs = Math.floor(Date.now() / 1000);
  const uncoveredPartitions = [];
  for (const row of partRows) {
    const tbl = (row.TABLE_NAME || row.table_name).toLowerCase();
    const maxBound = Number(row.max_bound);
    if (!Number.isFinite(maxBound) || maxBound <= nowTs) {
      uncoveredPartitions.push(`${tbl} (max partition bound ${row.max_bound})`);
    }
  }

  if (uncoveredPartitions.length > 0) {
    logger.error(
      { tables: uncoveredPartitions },
      'Partitioned tables have no named partition covering the current time — ' +
        'rows are landing in p_future; partition maintenance is not keeping up',
    );
    passed = false;
  } else if (partRows.length > 0) {
    logger.info(
      { partitionedTables: partRows.length },
      'Partition capacity check passed — all partitioned tables cover the current time',
    );
  }

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

module.exports = { runSmokeTest, extractTableNames, extractSchemaColumns };
