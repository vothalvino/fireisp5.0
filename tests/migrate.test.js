// =============================================================================
// Tests for migrate.js — splitStatements() helper
// =============================================================================
// Verifies that the DELIMITER-aware SQL pre-processor correctly splits
// migration files into individual executable statements, covering the
// regression introduced by migration 028 (snmp_rollup_events) which uses
// DELIMITER $$ to define stored procedures.
// =============================================================================

const { splitStatements } = require('../src/scripts/migrate');

describe('splitStatements()', () => {
  test('splits simple semicolon-separated statements', () => {
    const sql = `CREATE TABLE foo (id INT);\nCREATE TABLE bar (id INT);`;
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('CREATE TABLE foo');
    expect(stmts[1]).toContain('CREATE TABLE bar');
  });

  test('handles DELIMITER $$ blocks with embedded semicolons', () => {
    const sql = `
CREATE TABLE t (id INT);

DELIMITER $$

CREATE PROCEDURE my_proc()
BEGIN
  SELECT 1;
  SELECT 2;
END$$

DELIMITER ;

CREATE TABLE t2 (id INT);
`.trim();

    const stmts = splitStatements(sql);
    // Expect: CREATE TABLE t, CREATE PROCEDURE my_proc, CREATE TABLE t2
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain('CREATE TABLE t');
    expect(stmts[1]).toContain('CREATE PROCEDURE my_proc');
    expect(stmts[1]).toContain('SELECT 1;');  // inner semicolons preserved
    expect(stmts[2]).toContain('CREATE TABLE t2');
  });

  test('handles multiple procedures in one DELIMITER $$ block', () => {
    const sql = `
DELIMITER $$

CREATE PROCEDURE proc_a()
BEGIN
  SELECT 'a';
END$$

CREATE PROCEDURE proc_b()
BEGIN
  SELECT 'b';
END$$

DELIMITER ;
`.trim();

    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('proc_a');
    expect(stmts[1]).toContain('proc_b');
  });

  test('returns empty array for blank / comment-only input', () => {
    expect(splitStatements('')).toHaveLength(0);
    expect(splitStatements('   \n   ')).toHaveLength(0);
  });

  test('strips trailing delimiter from each statement', () => {
    const sql = `SELECT 1;`;
    const stmts = splitStatements(sql);
    expect(stmts[0]).toBe('SELECT 1');
  });

  test('handles CREATE EVENT statements after DELIMITER ;', () => {
    const sql = `
DELIMITER $$
CREATE PROCEDURE p() BEGIN SELECT 1; END$$
DELIMITER ;
CREATE EVENT IF NOT EXISTS evt ON SCHEDULE EVERY 1 HOUR DO CALL p();
`.trim();

    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('CREATE PROCEDURE p');
    expect(stmts[1]).toContain('CREATE EVENT');
  });

  test('real migration 028 content is split into >1 statement', () => {
    const fs = require('fs');
    const path = require('path');
    const sql028 = fs.readFileSync(
      path.resolve(__dirname, '../database/migrations/028_create_snmp_rollup_events.sql'),
      'utf8',
    );
    const stmts = splitStatements(sql028);
    // Expects at minimum: header+CREATE TABLE, INSERT IGNORE block, 4 procedures, 4 events = 10+
    expect(stmts.length).toBeGreaterThanOrEqual(10);
    // No statement should begin with DELIMITER
    for (const s of stmts) {
      expect(s.trim().toUpperCase()).not.toMatch(/^DELIMITER/);
    }
  });
});
