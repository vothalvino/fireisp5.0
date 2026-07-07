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
// expect a JSON string. Match the old `SET ?` behaviour explicitly.
function normaliseValue(v) {
  if (v !== null && v !== undefined && typeof v === 'object') return JSON.stringify(v);
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

module.exports = { buildInsert, buildUpdate, quoteIdent };
