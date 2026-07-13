// =============================================================================
// FireISP 5.0 — Static SQL column/ENUM drift check
// =============================================================================
// Runs src/scripts/sql-column-check.js as part of the normal suite so the gate
// fires locally (and in the coverage job), not only in the dedicated CI step.
//
// It also unit-tests the parser, because a checker with a broken parser is worse
// than no checker: it goes green while the drift is still there. The two parser
// bugs that actually bit while writing it are pinned below (SQL `--` comments in
// CREATE TABLE bodies; regex literals in `${…}` and after `return`).
// =============================================================================

const {
  run, parseSchema, scanLiterals, extractFromLiteral, literalValue,
} = require('../src/scripts/sql-column-check');

describe('sql-column-check: schema parser', () => {
  test('parses columns, ENUM values and backticked identifiers', () => {
    const tables = parseSchema(`
      CREATE TABLE IF NOT EXISTS \`widgets\` (
        id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        status   ENUM('on','off') NOT NULL DEFAULT 'off',
        label    VARCHAR(50) NULL,
        PRIMARY KEY (id),
        KEY idx_widgets_status (status),
        CONSTRAINT fk_w FOREIGN KEY (id) REFERENCES other(id)
      ) ENGINE=InnoDB;
    `);
    const t = tables.get('widgets');
    expect([...t.columns].sort()).toEqual(['id', 'label', 'status']);
    expect([...t.enums.get('status')]).toEqual(['on', 'off']);
    // Index/constraint lines are not columns.
    expect(t.columns.has('idx_widgets_status')).toBe(false);
    expect(t.columns.has('fk_w')).toBe(false);
  });

  test('a SQL -- comment does not swallow the column beneath it', () => {
    // This is how schema.sql is written, and the naive parse dropped every
    // commented column — which made the checker "prove" real columns missing.
    const tables = parseSchema(`
      CREATE TABLE IF NOT EXISTS things (
        id   BIGINT NOT NULL,
        -- SAT folio fiscal (UUID assigned by the PAC)
        uuid CHAR(36) NULL,
        -- another one
        name VARCHAR(10) NOT NULL
      );
    `);
    expect([...tables.get('things').columns].sort()).toEqual(['id', 'name', 'uuid']);
  });

  test('picks up columns added by ALTER TABLE ... ADD COLUMN', () => {
    const tables = parseSchema(`
      CREATE TABLE IF NOT EXISTS t (id BIGINT NOT NULL);
      ALTER TABLE t ADD COLUMN IF NOT EXISTS extra VARCHAR(10) NULL;
    `);
    expect(tables.get('t').columns.has('extra')).toBe(true);
  });

  test('generated columns are real columns', () => {
    const tables = parseSchema(
      'CREATE TABLE t (a INT NOT NULL, b INT GENERATED ALWAYS AS (a + 1) STORED);',
    );
    expect(tables.get('t').columns.has('b')).toBe(true);
  });
});

describe('sql-column-check: JS scanner', () => {
  test('finds SQL in single-quoted, double-quoted and template literals', () => {
    const { literals } = scanLiterals(`
      const a = 'UPDATE t SET x = 1';
      const b = \`INSERT INTO t (x) VALUES (?)\`;
    `);
    expect(literals.map((l) => l.text)).toEqual(
      expect.arrayContaining(['UPDATE t SET x = 1', 'INSERT INTO t (x) VALUES (?)']),
    );
  });

  test('a regex literal after `return` does not derail the scan', () => {
    // return /[,"\n\r]/.test(s) — the '"' inside the character class used to be
    // read as the start of a string, and the rest of the file was mis-scanned.
    const scan = scanLiterals(`
      function f(s) {
        return /[,"\\n\\r]/.test(s) ? \`"\${s}"\` : s;
      }
      const sql = 'UPDATE t SET x = 1';
    `);
    expect(scan).not.toBeNull();
    expect(scan.literals.some((l) => l.text === 'UPDATE t SET x = 1')).toBe(true);
  });

  test('a regex containing a quote inside a ${} interpolation does not derail the scan', () => {
    const scan = scanLiterals(
      'const csv = `"${String(v).replace(/"/g, \'""\')}"`;\nconst sql = `UPDATE t SET x = 1`;',
    );
    expect(scan).not.toBeNull();
    expect(scan.literals.some((l) => l.text === 'UPDATE t SET x = 1')).toBe(true);
  });

  test('comments are not scanned for SQL', () => {
    const { literals } = scanLiterals("// INSERT INTO fake (nope) VALUES (1)\nconst x = 1;");
    expect(literals).toHaveLength(0);
  });
});

describe('sql-column-check: statement extraction', () => {
  const cols = (sql) => extractFromLiteral(sql, 'f.js', 1).statements;

  test('INSERT ... VALUES: columns and positional literals', () => {
    const [st] = cols("INSERT INTO t (a, b, c) VALUES (?, 'x', NOW())");
    expect(st.kind).toBe('INSERT');
    expect(st.columns).toEqual(['a', 'b', 'c']);
    expect(literalValue(st.values[1])).toBe('x');
    expect(literalValue(st.values[0])).toBeNull();     // bound param
  });

  test('INSERT ... SELECT: the projection is matched positionally to the columns', () => {
    const [st] = cols("INSERT INTO t (a, b) SELECT c.id, 'lit' FROM contracts c WHERE c.id = ?");
    expect(st.columns).toEqual(['a', 'b']);
    expect(literalValue(st.values[1])).toBe('lit');
  });

  test('UPDATE: SET columns, with the WHERE clause excluded', () => {
    const [st] = cols("UPDATE t SET a = 1, b = 'x' WHERE c = 'not-a-target'");
    expect(st.columns).toEqual(['a', 'b']);
    expect(st.assigns.map((x) => x.col)).toEqual(['a', 'b']);
  });

  test('ON DUPLICATE KEY UPDATE targets the same table', () => {
    const st = cols('INSERT INTO t (a) VALUES (?) ON DUPLICATE KEY UPDATE b = VALUES(b)');
    expect(st.map((s) => s.kind)).toEqual(['INSERT', 'UPSERT']);
    expect(st[1].columns).toEqual(['b']);
  });

  test('a statement cannot bleed into the next one', () => {
    // Two separate literals: the ON DUPLICATE of the second must not be attributed
    // to the first (this false-positived a whole reseller table when it did).
    const first = cols('INSERT INTO a (x) VALUES (?)');
    expect(first).toHaveLength(1);
    expect(first[0].table).toBe('a');
  });

  test('dynamic column lists are skipped, not guessed', () => {
    const { statements, skipped } = extractFromLiteral(
      'INSERT INTO t (@@DYN@@) VALUES (@@DYN@@)', 'f.js', 1,
    );
    expect(statements).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].why).toMatch(/dynamic column list/);
  });

  test('dynamic table names are skipped, not guessed', () => {
    const { statements, skipped } = extractFromLiteral('UPDATE @@DYN@@ SET a = 1', 'f.js', 1);
    expect(statements).toHaveLength(0);
    expect(skipped[0].why).toMatch(/dynamic table name/);
  });
});

describe('sql-column-check: the repository is clean', () => {
  const result = run({ log: () => {} });

  test('every INSERT/UPDATE column in src/ exists on its table in schema.sql', () => {
    expect(result.errors).toEqual([]);
  });

  test('the check actually covers a meaningful number of statements', () => {
    // Guards against a parser regression that silently stops finding SQL and
    // therefore always passes.
    expect(result.insertCount).toBeGreaterThan(250);
    expect(result.updateCount).toBeGreaterThan(300);
    expect(result.enumCount).toBeGreaterThan(150);
  });

  test('every src file was scannable', () => {
    expect(result.notScanned).toEqual([]);
  });

  test('the known schema gaps are exactly the ones we have signed off on', () => {
    // If this fails, either a gap was closed (delete it from KNOWN_SCHEMA_GAPS)
    // or a NEW un-fixable-in-code bug appeared and needs a migration.
    expect(result.gaps.map((g) => g.split('  ')[1])).toEqual([
      'UPDATE users.reset_token_hash',
      'UPDATE users.reset_token_expires',
      'UPDATE users.reset_token_hash',
      'UPDATE users.reset_token_expires',
      'UPDATE users.email_verified_at',
      'UPDATE users.email_verify_token_hash',
      'UPDATE users.email_verify_token_hash',
    ]);
  });
});
