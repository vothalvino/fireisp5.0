// =============================================================================
// FireISP 5.0 — Safe dynamic INSERT/UPDATE builders
// =============================================================================
// The DB layer (src/config/database.js) sends every query through
// mysql2 `pool.execute()` (prepared statements). Prepared statements CANNOT
// expand the `SET ?` object shorthand that mysql2's `pool.query()` supports, so
// `db.query('INSERT ... SET ?', [obj])` / `db.query('UPDATE ... SET ?', [obj])`
// throws at runtime on every call. These helpers build an explicit,
// placeholder-parameterised column list from a plain object so the same dynamic
// writes work under `execute()`.
//
// The same limitation applies to the bulk multi-row form
// `INSERT INTO t (...) VALUES ?` with a single `?` bound to a 2-D array of
// rows: that array-to-tuples expansion (`(a,b),(c,d),...`) is implemented by
// `SqlString.format`, which only the `query()` text-protocol path uses —
// `execute()`'s prepared statements bind each `?` to one scalar and cannot
// expand an array parameter, so `db.query('INSERT ... VALUES ?', [rows])`
// throws at runtime on every call too. `buildBulkValues` builds the same
// explicit per-row placeholder groups plus a flat, positionally-ordered
// parameter array so bulk inserts work under `execute()`. Callers keep the
// table name and column list as literal SQL text in their own query string
// (never interpolate them from a runtime value) — only the returned
// `placeholders` string is interpolated, after the literal `VALUES` keyword —
// so `pnpm run sql:check` can still statically resolve the column list.
//
// Identifiers are validated and backtick-quoted (defence-in-depth: the field
// objects originate from request bodies whose keys are not strictly
// column-whitelisted). Object/array values are JSON-stringified to mirror what
// mysql2's `SET ?` did for JSON columns.
// =============================================================================

// A plain SQL identifier: leading letter/underscore, then word chars. Rejects
// anything that could break out of the backtick quoting.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(id) {
  if (typeof id !== 'string' || !SAFE_IDENT.test(id)) {
    throw new Error(`Unsafe SQL identifier: ${JSON.stringify(id)}`);
  }
  return `\`${id}\``;
}

// mysql2 execute() binds objects/arrays as strings unpredictably; JSON columns
// expect a JSON string. Match the old `SET ?` behaviour explicitly. `Date`
// instances are passed through as-is (not JSON.stringify'd): mysql2's
// execute() already binds a JS Date to a DATETIME/TIMESTAMP column
// natively, same as any other single-value execute() call in the codebase —
// `typeof someDate === 'object'` would otherwise wrap it in a quoted JSON
// string (e.g. `"2026-01-01T00:00:00.000Z"`), corrupting the column.
function normaliseValue(v) {
  if (v !== null && v !== undefined && typeof v === 'object' && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  return v === undefined ? null : v;
}

/**
 * Build an `INSERT INTO <table> (cols) VALUES (placeholders)` from an object.
 * @param {object} obj  column -> value
 * @returns {{ columns: string, placeholders: string, values: any[] }}
 */
function buildInsert(obj) {
  const keys = Object.keys(obj || {});
  if (keys.length === 0) throw new Error('buildInsert: no columns to insert');
  return {
    columns: keys.map(quoteIdent).join(', '),
    placeholders: keys.map(() => '?').join(', '),
    values: keys.map((k) => normaliseValue(obj[k])),
  };
}

/**
 * Build a `SET col = ?, ...` assignment clause from an object.
 * Returns an empty `assignments` string when obj has no keys, so callers can
 * fall back to a fixed clause (e.g. just `updated_at = NOW()`).
 * @param {object} obj  column -> value
 * @returns {{ assignments: string, values: any[] }}
 */
function buildUpdate(obj) {
  const keys = Object.keys(obj || {});
  return {
    assignments: keys.map((k) => `${quoteIdent(k)} = ?`).join(', '),
    values: keys.map((k) => normaliseValue(obj[k])),
  };
}

/**
 * Build a multi-row `VALUES (?,?,...), (?,?,...)` clause plus a flat,
 * positionally-ordered parameter array for a bulk INSERT under `execute()`.
 *
 * Does NOT touch the table name or column list — callers keep those as
 * literal SQL text in their own template (e.g.
 * `` `INSERT INTO t (a, b) VALUES ${placeholders}` ``) both so the statement
 * stays statically checkable and so this helper needs no column names, only
 * row shape.
 *
 * @param {Array<Array<any>>} rows  One array of values per row, all the same
 *   length and in the same order as the caller's column list.
 * @returns {{ placeholders: string, values: any[] }}
 *   `placeholders` is '' and `values` is [] for an empty/absent `rows` — the
 *   caller must still skip issuing the query in that case (`VALUES ` with no
 *   tuples is not valid SQL); every existing call site already early-returns
 *   before building rows when there is nothing to insert.
 */
function buildBulkValues(rows) {
  if (!rows || rows.length === 0) return { placeholders: '', values: [] };

  const width = rows[0].length;
  const rowPlaceholder = `(${Array(width).fill('?').join(', ')})`;
  const values = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error(
        `buildBulkValues: row length ${Array.isArray(row) ? row.length : typeof row} does not match first row length ${width}`,
      );
    }
    for (const v of row) values.push(normaliseValue(v));
  }

  return {
    placeholders: rows.map(() => rowPlaceholder).join(', '),
    values,
  };
}

module.exports = { buildInsert, buildUpdate, buildBulkValues, quoteIdent };
