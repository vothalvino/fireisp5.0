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
  extractSelectRefs, RUNTIME_GUARDED_SELECT_EXCEPTIONS,
} = require('../src/scripts/sql-column-check');

/** Build a minimal {table -> {columns, enums, generated}} map for extractSelectRefs tests. */
function tablesOf(spec) {
  const m = new Map();
  for (const [name, cols] of Object.entries(spec)) {
    m.set(name, { columns: new Set(cols), enums: new Map(), generated: new Set() });
  }
  return m;
}

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

  test('generated columns are real columns, but flagged as generated', () => {
    const tables = parseSchema(
      'CREATE TABLE t (a INT NOT NULL, b INT GENERATED ALWAYS AS (a + 1) STORED);',
    );
    expect(tables.get('t').columns.has('b')).toBe(true);
    expect(tables.get('t').generated.has('b')).toBe(true);
    expect(tables.get('t').generated.has('a')).toBe(false);
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

describe('sql-column-check: SELECT column-reference checking', () => {
  test('single-table: bare identifiers in WHERE/SELECT are checked against the sole table', () => {
    const tables = tablesOf({ suspension_rules: ['id', 'organization_id', 'is_active'] });
    const r = extractSelectRefs(
      "SELECT * FROM suspension_rules WHERE organization_id = ? AND is_enabled = TRUE",
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/suspension_rules.*"is_enabled"/);
  });

  test('single-table: a real bare column passes cleanly', () => {
    const tables = tablesOf({ suspension_rules: ['id', 'organization_id', 'is_active'] });
    const r = extractSelectRefs(
      'SELECT * FROM suspension_rules WHERE organization_id = ? AND is_active = TRUE',
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(0);
    expect(r.refCount).toBeGreaterThan(0);
  });

  test('multi-table JOIN: qualified references are checked against the resolved table', () => {
    const tables = tablesOf({
      contracts: ['id', 'client_id', 'status'],
      invoices: ['id', 'contract_id', 'organization_id', 'due_date', 'total'],
    });
    const r = extractSelectRefs(
      `SELECT c.id, i.due_date, i.total
         FROM contracts c
         JOIN invoices i ON i.contract_id = c.id AND i.organization_id = ?
        WHERE c.status = 'active'`,
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(0);
    expect(r.refCount).toBeGreaterThan(0);
  });

  test('multi-table JOIN: a qualified reference to a nonexistent column is caught', () => {
    const tables = tablesOf({
      contracts: ['id', 'client_id', 'status'],
      invoices: ['id', 'contract_id', 'organization_id'],
    });
    const r = extractSelectRefs(
      `SELECT c.id, i.total
         FROM contracts c
         JOIN invoices i ON i.contract_id = c.id`,
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/invoices.*"total"/);
  });

  test('multi-table JOIN: a BARE (unqualified) identifier is never guessed', () => {
    const tables = tablesOf({
      contracts: ['id', 'client_id'],
      invoices: ['id', 'contract_id'],
    });
    const r = extractSelectRefs(
      `SELECT c.id FROM contracts c JOIN invoices i ON i.contract_id = c.id WHERE nonexistent_bare_column = 1`,
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(0);   // ambiguous — skipped, not flagged
  });

  test('FROM/JOIN target that does not exist in schema.sql is a real error', () => {
    const tables = tablesOf({ contracts: ['id'] });
    const r = extractSelectRefs('SELECT * FROM onu_devices WHERE client_id = ?', 'f.js', 1, tables);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/table "onu_devices" does not exist/);
  });

  test('`alias.*` is not checked as a bare reference to the alias letter', () => {
    const tables = tablesOf({ rma_requests: ['id', 'organization_id'] });
    const r = extractSelectRefs('SELECT r.* FROM rma_requests r WHERE r.organization_id = ?', 'f.js', 1, tables);
    expect(r.errors).toHaveLength(0);
  });

  test('a SELECT-list alias may be reused bare in ORDER BY (legal SQL, not a missing column)', () => {
    const tables = tablesOf({ connection_logs: ['id', 'event_at', 'client_id'] });
    const r = extractSelectRefs(
      `SELECT DATE(event_at) AS usage_date, client_id
         FROM connection_logs
        WHERE client_id = ?
        ORDER BY usage_date DESC`,
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(0);
  });

  test('`FOR UPDATE` row-locking is not mistaken for a column named "update"', () => {
    const tables = tablesOf({ billing_periods: ['id', 'status'] });
    const r = extractSelectRefs('SELECT * FROM billing_periods WHERE id = ? FOR UPDATE', 'f.js', 1, tables);
    expect(r.errors).toHaveLength(0);
  });

  test('a UNION is not descended into (the second SELECT has its own tables)', () => {
    const tables = tablesOf({
      users: ['id', 'organization_id', 'role'],
      organization_users: ['id', 'organization_id', 'user_id', 'role'],
    });
    const r = extractSelectRefs(
      `SELECT id FROM users WHERE organization_id = ? AND role = 'admin'
       UNION
       SELECT user_id FROM organization_users WHERE organization_id = ?`,
      'f.js', 1, tables,
    );
    expect(r.skipped.some((s) => /UNION/.test(s.why))).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  test('a nested subquery is not descended into', () => {
    const tables = tablesOf({ clients: ['id', 'organization_id'] });
    const r = extractSelectRefs(
      `SELECT id FROM clients WHERE id IN (SELECT anything FROM whatever_table)`,
      'f.js', 1, tables,
    );
    expect(r.skipped.some((s) => /nested subquery/.test(s.why))).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  test('the @@DYN@@ template-interpolation marker is never checked as a column, bare or backtick-quoted', () => {
    const tables = tablesOf({ snmp_metrics: ['device_id', 'polled_at'] });
    const bare = extractSelectRefs('SELECT device_id, @@DYN@@ FROM snmp_metrics', 'f.js', 1, tables);
    expect(bare.errors).toHaveLength(0);
    const quoted = extractSelectRefs('SELECT device_id, `@@DYN@@` FROM snmp_metrics', 'f.js', 1, tables);
    expect(quoted.errors).toHaveLength(0);
  });

  test('an INFORMATION_SCHEMA query is external and never flagged', () => {
    const tables = tablesOf({ contracts: ['id'] });
    const r = extractSelectRefs(
      "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'contracts'",
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(0);
  });

  test('SQL -- comments inside a SELECT are stripped, not scanned as identifiers', () => {
    // This is the SELECT-path counterpart of the INSERT/UPDATE comment-
    // stripping bug — without it, English prose in a comment (e.g. "gives 3
    // poll cycles of headroom") was reported as missing columns.
    const tables = tablesOf({ snmp_metrics: ['device_id', 'polled_at'] });
    const r = extractSelectRefs(
      `SELECT device_id
         FROM snmp_metrics
        WHERE polled_at >= NOW() - INTERVAL 15 MINUTE
          -- 15-minute window: gives 3 poll cycles of headroom before stale`,
      'f.js', 1, tables,
    );
    expect(r.errors).toHaveLength(0);
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
    // SELECT coverage — the newer half of the gate (WHERE / SELECT-list /
    // JOIN...ON / ORDER BY column references, plus FROM/JOIN table existence).
    expect(result.selectChecked).toBeGreaterThan(1000);
    expect(result.selectRefCount).toBeGreaterThan(5000);
  });

  test('every src file was scannable', () => {
    expect(result.notScanned).toEqual([]);
  });

  test('the known schema gaps are exactly the ones we have signed off on', () => {
    // If this fails, either a gap was closed (delete it from KNOWN_SCHEMA_GAPS)
    // or a NEW un-fixable-in-code bug appeared and needs a migration. Both the
    // INSERT/UPDATE and SELECT sides of the same users.reset_token_hash /
    // reset_token_expires / email_verified_at / email_verify_token_hash gap
    // show up here — there is still no storage for password reset / email
    // verification anywhere in the schema.
    expect(result.gaps.map((g) => g.split('  ')[1])).toEqual([
      'UPDATE users.reset_token_hash',
      'UPDATE users.reset_token_expires',
      'SELECT users.reset_token_hash',
      'SELECT users.reset_token_expires',
      'UPDATE users.reset_token_hash',
      'UPDATE users.reset_token_expires',
      'SELECT users.email_verify_token_hash',
      'UPDATE users.email_verified_at',
      'UPDATE users.email_verify_token_hash',
      'UPDATE users.email_verify_token_hash',
    ]);
  });

  test('the one runtime-guarded SELECT exception is exactly the one we verified by hand', () => {
    // Not a gap (no migration needed) — a query that only ever runs behind an
    // INFORMATION_SCHEMA.COLUMNS existence check. Adding to this list must
    // stay rare and always hand-verified; this test makes growing it visible.
    expect(RUNTIME_GUARDED_SELECT_EXCEPTIONS).toHaveLength(1);
    expect(RUNTIME_GUARDED_SELECT_EXCEPTIONS[0]).toMatchObject({
      file: 'src/services/cpeInventoryService.js',
      table: 'contracts',
      columns: ['cpe_serial_number'],
    });
  });
});
