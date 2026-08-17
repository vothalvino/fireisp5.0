// Migration writers must serialize when multiple Kubernetes pods start the
// same image concurrently. This test exercises the advisory-lock boundary
// without opening a real database connection.

const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  baseConnectionConfig: { database: 'fireisp_test' },
  close: jest.fn(),
}));

const { applyMigrations, splitStatements } = require('../src/scripts/migrate');

const everyMigration = fs.readdirSync(path.join(__dirname, '../database/migrations'))
  .filter(file => file.endsWith('.sql'))
  .map(filename => ({ filename }));

function connectionWithLock(acquired = 1) {
  const conn = {
    execute: jest.fn(async (sql) => {
      if (/SELECT DATABASE\(\)/.test(sql)) return [[{ database_name: 'fireisp_test' }]];
      if (/GET_LOCK/.test(sql)) return [[{ acquired }]];
      if (/SELECT filename FROM schema_migrations/.test(sql)) return [everyMigration];
      if (/RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      return [{ affectedRows: 0 }];
    }),
    query: jest.fn(),
    release: jest.fn(),
  };
  return conn;
}

describe('migration advisory lock', () => {
  test('holds one stable target lock around migration discovery and releases it', async () => {
    const conn = connectionWithLock();
    const pool = { getConnection: jest.fn().mockResolvedValue(conn) };

    await applyMigrations(pool, 'primary:fireisp_test');

    const statements = conn.execute.mock.calls.map(([sql]) => sql);
    const acquireAt = statements.findIndex(sql => /GET_LOCK/.test(sql));
    const discoverAt = statements.findIndex(sql => /SELECT filename FROM schema_migrations/.test(sql));
    const releaseAt = statements.findIndex(sql => /RELEASE_LOCK/.test(sql));
    expect(statements[0]).toMatch(/SELECT DATABASE\(\)/);
    expect(acquireAt).toBe(1);
    expect(discoverAt).toBeGreaterThan(acquireAt);
    expect(releaseAt).toBeGreaterThan(discoverAt);

    const acquireName = conn.execute.mock.calls[acquireAt][1][0];
    const releaseName = conn.execute.mock.calls[releaseAt][1][0];
    expect(acquireName).toBe(releaseName);
    expect(acquireName.length).toBeLessThanOrEqual(64);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  test('fails closed when another writer holds the target lock', async () => {
    const conn = connectionWithLock(0);
    const pool = { getConnection: jest.fn().mockResolvedValue(conn) };

    await expect(applyMigrations(pool, 'primary:fireisp_test'))
      .rejects.toThrow('Could not acquire the migration lock');

    expect(conn.execute.mock.calls.some(([sql]) => /CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)))
      .toBe(false);
    expect(conn.execute.mock.calls.some(([sql]) => /RELEASE_LOCK/.test(sql))).toBe(false);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe('migration statement splitting', () => {
  test('does not emit a comment-only query before DELIMITER', () => {
    const statements = splitStatements(`-- restart-safe migration header
# another comment
/* ordinary block comment */
DELIMITER $$
DROP PROCEDURE IF EXISTS example$$
DELIMITER ;
SELECT 1;
`);

    expect(statements).toEqual([
      'DROP PROCEDURE IF EXISTS example',
      'SELECT 1',
    ]);
  });

  test('preserves executable MySQL comments', () => {
    expect(splitStatements('/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE */;'))
      .toEqual(['/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE */']);
  });
});
