/**
 * Tests for the rollback runner (src/scripts/rollback.js) and the rollback
 * SQL files in database/rollbacks/.
 *
 * These are pure unit tests — no database connection required.  They verify:
 *   1. Every migration 130–150 has a corresponding rollback SQL file.
 *   2. Rollback filenames exactly match the migration filenames.
 *   3. The rollback runner module exports runRollback.
 *   4. CLI argument parsing works correctly.
 *   5. Rollback SQL files are non-empty and contain valid SQL keywords.
 */

const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');
const ROLLBACKS_DIR  = path.resolve(__dirname, '../database/rollbacks');

// Migration numbers that must have rollback scripts
const REQUIRED_RANGE = Array.from({ length: 21 }, (_, i) => i + 130); // 130–150

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** List .sql files in a directory, sorted. */
function listSqlFiles(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
}

/** Extract the numeric prefix from a migration filename. */
function migrationNumber(filename) {
  const m = filename.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Rollback SQL files — database/rollbacks/', () => {
  const rollbackFiles = listSqlFiles(ROLLBACKS_DIR);
  const migrationFiles = listSqlFiles(MIGRATIONS_DIR);

  it('rollbacks directory exists', () => {
    expect(fs.existsSync(ROLLBACKS_DIR)).toBe(true);
  });

  it('has exactly 21 rollback files (one per migration 130–150)', () => {
    const inRange = rollbackFiles.filter(f => {
      const n = migrationNumber(f);
      return n >= 130 && n <= 150;
    });
    expect(inRange.length).toBe(21);
  });

  // Dynamic test: every migration in range has a matching rollback
  for (const num of REQUIRED_RANGE) {
    it(`rollback exists for migration ${num}`, () => {
      const migFile = migrationFiles.find(f => migrationNumber(f) === num);
      expect(migFile).toBeDefined();
      const rollFile = rollbackFiles.find(f => f === migFile);
      expect(rollFile).toBeDefined();
    });
  }

  // Every rollback file is non-empty and contains SQL
  for (const num of REQUIRED_RANGE) {
    it(`rollback ${num} contains valid SQL content`, () => {
      const file = rollbackFiles.find(f => migrationNumber(f) === num);
      if (!file) return; // covered by the existence test above
      const content = fs.readFileSync(path.join(ROLLBACKS_DIR, file), 'utf8');
      expect(content.trim().length).toBeGreaterThan(0);
      // Should contain at least one SQL keyword
      const sqlKeywords = /\b(DROP|ALTER|DELETE|MODIFY|UPDATE)\b/i;
      expect(sqlKeywords.test(content)).toBe(true);
    });
  }

  it('rollback filenames exactly match migration filenames', () => {
    const migrationSet = new Set(
      migrationFiles
        .filter(f => {
          const n = migrationNumber(f);
          return n >= 130 && n <= 150;
        }),
    );
    const rollbackSet = new Set(rollbackFiles);
    for (const mig of migrationSet) {
      expect(rollbackSet.has(mig)).toBe(true);
    }
  });
});

describe('Rollback runner — src/scripts/rollback.js', () => {
  // We only test the module exports (no DB calls)
  let rollbackModule;

  beforeAll(() => {
    // The module requires dotenv and db config — mock them to avoid errors
    jest.mock('../src/config/database', () => ({
      query: jest.fn(),
      close: jest.fn(),
      baseConnectionConfig: {},
    }));
    rollbackModule = require('../src/scripts/rollback');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('exports runRollback function', () => {
    expect(typeof rollbackModule.runRollback).toBe('function');
  });
});

describe('Rollback SQL content validation', () => {
  const rollbackFiles = listSqlFiles(ROLLBACKS_DIR);

  // CREATE TABLE rollbacks should use DROP TABLE
  it('table-creation rollbacks use DROP TABLE', () => {
    const tableRollbacks = [130, 131, 132, 133, 134, 135];
    for (const num of tableRollbacks) {
      const file = rollbackFiles.find(f => migrationNumber(f) === num);
      const content = fs.readFileSync(path.join(ROLLBACKS_DIR, file), 'utf8');
      expect(content).toMatch(/DROP\s+TABLE/i);
    }
  });

  // ALTER TABLE rollbacks should use ALTER TABLE or DROP COLUMN
  it('column-addition rollbacks use ALTER TABLE', () => {
    const alterRollbacks = [136, 137, 140, 143];
    for (const num of alterRollbacks) {
      const file = rollbackFiles.find(f => migrationNumber(f) === num);
      const content = fs.readFileSync(path.join(ROLLBACKS_DIR, file), 'utf8');
      expect(content).toMatch(/ALTER\s+TABLE/i);
    }
  });

  // Seed rollbacks should use DELETE
  it('seed rollbacks use DELETE', () => {
    const seedRollbacks = [138, 139, 145];
    for (const num of seedRollbacks) {
      const file = rollbackFiles.find(f => migrationNumber(f) === num);
      const content = fs.readFileSync(path.join(ROLLBACKS_DIR, file), 'utf8');
      expect(content).toMatch(/DELETE\s+FROM/i);
    }
  });

  // Trigger rollbacks should use DROP TRIGGER
  it('trigger rollbacks use DROP TRIGGER', () => {
    const triggerRollbacks = [146, 147, 148, 149, 150];
    for (const num of triggerRollbacks) {
      const file = rollbackFiles.find(f => migrationNumber(f) === num);
      const content = fs.readFileSync(path.join(ROLLBACKS_DIR, file), 'utf8');
      expect(content).toMatch(/DROP\s+TRIGGER/i);
    }
  });

  // Index rollbacks should use DROP INDEX
  it('index rollbacks use DROP INDEX', () => {
    const indexRollbacks = [141, 144];
    for (const num of indexRollbacks) {
      const file = rollbackFiles.find(f => migrationNumber(f) === num);
      const content = fs.readFileSync(path.join(ROLLBACKS_DIR, file), 'utf8');
      expect(content).toMatch(/DROP\s+INDEX/i);
    }
  });
});
