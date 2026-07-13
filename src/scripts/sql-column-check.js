#!/usr/bin/env node
// =============================================================================
// FireISP 5.0 — Static SQL column / ENUM check (no database required)
// =============================================================================
// FireISP's #1 historical bug class is column-name drift: the DB is fully mocked
// in the jest suite, so an INSERT/UPDATE naming a column that does not exist
// passes every test and 500s in production forever. `suspension_logs` shipped
// exactly like that — four INSERTs writing `performed_by`, `invoice_id`,
// `coa_sent`, `coa_response` (none of which exist) plus `action` values that are
// not in the ENUM — which broke EVERY suspend/reconnect path, including the
// auto-reconnect that runs after a customer pays their invoice.
//
// This script closes that hole without a database:
//
//   1. Parse database/schema.sql  → { table: { columns, enums } }
//   2. Scan every src/**/*.js     → SQL string literals → INSERT / UPDATE
//   3. Assert every referenced column exists on that table, and that every
//      statically-visible single-quoted literal written into an ENUM column is
//      one of that ENUM's values.
//
// Statements whose table or column list is built dynamically (template
// interpolation) CANNOT be resolved statically. They are SKIPPED — never
// guessed — and counted, so the check is honest about its own coverage.
//
// Usage:
//   node src/scripts/sql-column-check.js            (exit 1 on any error)
//   node src/scripts/sql-column-check.js --verbose  (also list skipped stmts)
// =============================================================================

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_FILE = path.join(REPO_ROOT, 'database', 'schema.sql');
const SRC_DIR = path.join(REPO_ROOT, 'src');

// Marker substituted for `${...}` template interpolations. Contains characters
// that can never appear in a SQL identifier, so a column list containing it is
// unmistakably dynamic.
const DYN = '@@DYN@@';

// Tables the app talks to that are intentionally NOT in schema.sql. Most
// FreeRADIUS tables (radcheck, radreply, radusergroup, radgroupcheck,
// radgroupreply, radpostauth) are actually MIRRORED in schema.sql — FireISP
// writes them directly, so they must be checked like any other table. Only
// `radacct` (FreeRADIUS's own accounting table, written by FreeRADIUS itself,
// never by FireISP) and `nas` were originally listed here as "external" — that
// was wrong for `nas`: FireISP owns a first-party `nas` table (device
// inventory + RADIUS secrets) that IS in schema.sql, and excluding it meant
// every INSERT/UPDATE against it went completely unchecked.
// `information_schema` is MySQL's built-in system schema (used for runtime
// `IF COLUMN EXISTS`-style guards, e.g. cpeInventoryService.js) — never a
// table in our own schema.sql, and never checkable against it.
const EXTERNAL_TABLES = new Set(['radacct', 'information_schema']);

// Words that may follow `UPDATE <table>` but are not a table alias.
const NOT_AN_ALIAS = new Set(['set', 'join', 'inner', 'left', 'right', 'cross', 'straight_join', 'where']);

// -----------------------------------------------------------------------------
// KNOWN SCHEMA GAPS — pre-existing breakage this check cannot fix in code.
// -----------------------------------------------------------------------------
// These are NOT false positives and NOT "allowed" — they are live bugs whose fix
// needs a MIGRATION (the column genuinely does not exist anywhere in the schema),
// which is out of scope for the PR that introduced this script. They are printed
// on every run, and the ratchet still holds: any NEW drift, or any drift on a
// table/column not listed here, fails the build.
//
// Removing an entry from this list is how you close the gap.
//
// Migration 382 added reset_token_hash/reset_token_expires/email_verified_at/
// email_verify_token_hash to `users` — the entry that used to document that gap
// here is gone; this check now enforces those four statements for real.
const KNOWN_SCHEMA_GAPS = [];

function isKnownGap(st, column) {
  return KNOWN_SCHEMA_GAPS.some(
    (g) => g.file === st.file && g.table === st.table && g.columns.includes(column),
  );
}

// -----------------------------------------------------------------------------
// KNOWN MISSING TABLES — same ratchet as KNOWN_SCHEMA_GAPS above, but for a
// FROM/JOIN target that was never created at all (not a column typo — the
// whole table doesn't exist in schema.sql). Column-level checks against these
// are already skipped for free (an unresolved table has no `schema.columns`
// to check against); this list only silences the table-existence error
// itself, so the ratchet still fails on any NEW missing-table reference.
// -----------------------------------------------------------------------------
const KNOWN_MISSING_TABLES = [
];

function isKnownMissingTable(file, table) {
  return KNOWN_MISSING_TABLES.some((g) => g.file === file && g.table === table);
}

// -----------------------------------------------------------------------------
// RUNTIME-GUARDED SELECT EXCEPTIONS — different from KNOWN_SCHEMA_GAPS above:
// these do NOT need a migration. Each is a SELECT that only ever runs after an
// explicit `INFORMATION_SCHEMA.COLUMNS` existence check at runtime (a
// deliberate "use this optional column if some deployment's schema has it"
// pattern) — correct as written, just invisible to a static checker, which
// cannot see the runtime guard. Add an entry ONLY when you have verified the
// guard yourself; this is not a place to silence a real hit.
// -----------------------------------------------------------------------------
const RUNTIME_GUARDED_SELECT_EXCEPTIONS = [
  {
    file: 'src/services/cpeInventoryService.js',
    table: 'contracts',
    columns: ['cpe_serial_number'],
    why: "tryAutoLinkSubscriber's Strategy 1 queries contracts.cpe_serial_number only after checking "
       + 'INFORMATION_SCHEMA.COLUMNS confirms it exists on this deployment; it is optional schema, not a bug.',
  },
];

function isGuardedSelectException(file, table, column) {
  return RUNTIME_GUARDED_SELECT_EXCEPTIONS.some(
    (g) => g.file === file && g.table === table && g.columns.includes(column),
  );
}

// =============================================================================
// 1. schema.sql → Map(table → { columns: Set, enums: Map(col → Set(values)) })
// =============================================================================

/** Split on top-level commas (paren-depth and quote aware). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let buf = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if (ch === '\\') { buf += text[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

/** Read the balanced parenthesised body starting at `open` (index of '('). */
function readBalanced(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Parse the value list out of an `ENUM('a','b')` column definition. */
function parseEnumValues(def) {
  const m = /\bENUM\s*\(/i.exec(def);
  if (!m) return null;
  const bal = readBalanced(def, m.index + m[0].length - 1);
  if (!bal) return null;
  const values = new Set();
  const re = /'((?:[^'\\]|\\.|'')*)'/g;
  let v;
  while ((v = re.exec(bal.body))) values.add(unquote(v[1]));
  return values;
}

const unquote = (s) => s.replace(/\\'/g, "'").replace(/''/g, "'").replace(/\\\\/g, '\\');

/** True when a column definition is `GENERATED ALWAYS AS (...) STORED|VIRTUAL`. */
const isGeneratedColumnDef = (def) => /\bGENERATED\s+ALWAYS\s+AS\s*\(/i.test(def);

/**
 * Blank out SQL line comments (`-- …`, `# …`) and block comments, preserving offsets and
 * newlines. Quote-aware, so a `COMMENT 'contains -- dashes'` is left alone.
 *
 * schema.sql documents most columns with a `-- …` line directly above them; a
 * naive parse silently drops the column that follows every such comment (that is
 * how the first draft of this script "proved" cfdi_documents.uuid didn't exist).
 */
function stripSqlComments(sql) {
  let out = '';
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += sql[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; continue; }
    if ((ch === '-' && sql[i + 1] === '-' && /[\s]/.test(sql[i + 2] ?? '\n')) || ch === '#') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const NON_COLUMN_KEYWORDS = /^(PRIMARY|UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL|CONSTRAINT|FOREIGN|CHECK|PERIOD)\b/i;

function parseSchema(rawSqlText) {
  const sqlText = stripSqlComments(rawSqlText);
  const tables = new Map();

  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/gi;
  let m;
  while ((m = re.exec(sqlText))) {
    const table = m[1].toLowerCase();
    const bal = readBalanced(sqlText, m.index + m[0].length - 1);
    if (!bal) continue;
    const entry = tables.get(table) || { columns: new Set(), enums: new Map(), generated: new Set() };
    for (const raw of splitTopLevel(bal.body)) {
      const def = raw.trim();
      if (!def || NON_COLUMN_KEYWORDS.test(def)) continue;
      const nameMatch = /^[`"]?(\w+)[`"]?\s+/.exec(def);
      if (!nameMatch) continue;
      const col = nameMatch[1].toLowerCase();
      entry.columns.add(col);                       // the column exists...
      if (isGeneratedColumnDef(def)) entry.generated.add(col);  // ...but MySQL rejects any explicit value for it
      const values = parseEnumValues(def);
      if (values && values.size > 0) entry.enums.set(col, values);
    }
    tables.set(table, entry);
    re.lastIndex = bal.end;
  }

  // schema.sql also carries idempotent ALTER blocks (inside stored procedures)
  // mirroring later migrations — fold those in so they aren't reported missing.
  const alterAdd = /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s+([^;]*)/gi;
  while ((m = alterAdd.exec(sqlText))) {
    const t = tables.get(m[1].toLowerCase());
    const col = m[2].toLowerCase();
    if (!t || NON_COLUMN_KEYWORDS.test(col)) continue;
    t.columns.add(col);
    const values = parseEnumValues(m[3]);
    if (values && values.size > 0) t.enums.set(col, values);
  }
  // ...and MODIFY/CHANGE, which is how ENUM value sets get widened.
  const alterMod = /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s+(?:[`"]?(\w+)[`"]?\s+)?([^;]*)/gi;
  while ((m = alterMod.exec(sqlText))) {
    const t = tables.get(m[1].toLowerCase());
    if (!t) continue;
    const col = (m[3] || m[2]).toLowerCase();
    if (!t.columns.has(col)) continue;
    const values = parseEnumValues(m[4]);
    if (values && values.size > 0) t.enums.set(col, values);
  }

  return tables;
}

// =============================================================================
// 2. JS source → the SQL string literals it contains
// =============================================================================

// A '/' starts a regex literal only where a *value* may begin. That is either
// after an operator/punctuator, or after a keyword such as `return` — the latter
// is easy to forget and gets you `return /[,"\n]/.test(s)` parsed as a division
// followed by an unterminated string.
const VALUE_POSITION_PUNCT = /[(,=:[!&|?{};+\-*%~^<>]/;
const VALUE_POSITION_KEYWORD = /(?:^|[^\w$.])(return|typeof|case|in|of|do|else|yield|await|delete|void|throw|new)\s*$/;

function startsRegex(src, i, prev) {
  if (prev === '' || VALUE_POSITION_PUNCT.test(prev)) return true;
  return VALUE_POSITION_KEYWORD.test(src.slice(Math.max(0, i - 16), i));
}

/**
 * Read a balanced {...} starting at `open` (index of '{') — i.e. the body of a
 * `${…}` template interpolation, which is arbitrary JS: nested templates,
 * strings, and regex literals all have to be stepped over. (A regex like
 * `str.replace(/"/g, '""')` is exactly what tripped the first version of this.)
 */
function readBalancedCurly(src, open) {
  let depth = 0;
  let prev = '';
  for (let i = open; i < src.length; i++) {
    const ch = src[i];

    // Comments
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e === -1 ? src.length : e; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 1; continue; }

    // Regex literal
    if (ch === '/' && startsRegex(src, i, prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { i = j; prev = '/'; continue; }
    }

    // Strings / nested templates
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === ch) break;
        // A nested `${…}` inside a nested template may itself contain braces.
        if (ch === '`' && src[j] === '$' && src[j + 1] === '{') {
          const inner = readBalancedCurly(src, j + 1);
          if (!inner) return null;
          j = inner.end + 1;
          continue;
        }
        j++;
      }
      if (j >= src.length) return null;
      i = j;
      prev = ch;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { end: i };
    }
    if (!/\s/.test(ch)) prev = ch;
  }
  return null;
}

/**
 * Scan a JS file and return every string/template literal, with `${...}`
 * interpolations replaced by DYN and the source line each literal starts on.
 *
 * This is a hand-rolled scanner, not a real JS parser: the repo has no parser as
 * a direct dependency, and a full parse is not needed — we only need the string
 * literals, which is where all SQL lives. Regex literals are recognised with the
 * usual "what came before" heuristic. If the scan ends in an impossible state
 * (unterminated literal), the file is reported as not-scanned rather than
 * silently mis-parsed — an honest gap beats a wrong answer.
 *
 * @returns {{literals: Array<{text: string, line: number}>}|null}
 */
function scanLiterals(src) {
  const literals = [];
  let i = 0;
  let line = 1;
  let prev = '';                              // previous significant character
  const n = src.length;

  const countLines = (s) => { for (const c of s) if (c === '\n') line++; };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '\n') { line++; i++; continue; }

    // Line comment
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      countLines(src.slice(i, stop));
      i = stop;
      continue;
    }
    // Regex literal (only where a value may legally start)
    if (ch === '/' && startsRegex(src, i, prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') break;                // unterminated → it was a division
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { i = j + 1; prev = '/'; continue; }
      // else: fall through and treat '/' as an operator
    }
    // Single/double quoted string
    if (ch === "'" || ch === '"') {
      const startLine = line;
      let j = i + 1;
      let text = '';
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          if (src[j + 1] === '\n') { line++; j += 2; continue; }   // line continuation
          text += c + (src[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (c === ch) break;
        if (c === '\n') return null;           // impossible in a valid JS string
        text += c;
        j++;
      }
      if (j >= n) return null;
      literals.push({ text, line: startLine });
      prev = ch;
      i = j + 1;
      continue;
    }
    // Template literal
    if (ch === '`') {
      const startLine = line;
      let j = i + 1;
      let text = '';
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          const next = src[j + 1];
          // A backtick-quoted SQL identifier inside a template literal is
          // written as `\`col\`` — the escape exists only so the JS parser
          // doesn't treat it as the end of the template. At runtime it IS a
          // literal backtick, so unescape it (and `\$`, for the same reason —
          // otherwise `` `\`col\`` `` parsed downstream keeps a stray
          // backslash and no longer matches /^\w+$/, wrongly reported as a
          // "dynamic table name"). Other escapes (\n, \\, …) are left as-is —
          // irrelevant to SQL keyword/identifier matching either way.
          if (next === '`' || next === '$') { text += next; j += 2; continue; }
          text += c + (next ?? ''); j += 2; continue;
        }
        if (c === '`') break;
        if (c === '$' && src[j + 1] === '{') {
          const bal = readBalancedCurly(src, j + 1);
          if (!bal) return null;
          countLines(src.slice(j, bal.end + 1));
          text += DYN;
          j = bal.end + 1;
          continue;
        }
        if (c === '\n') line++;
        text += c;
        j++;
      }
      if (j >= n) return null;
      literals.push({ text, line: startLine });
      prev = '`';
      i = j + 1;
      continue;
    }

    if (!/\s/.test(ch)) prev = ch;
    i++;
  }

  return { literals };
}

// =============================================================================
// 3. SQL literal → INSERT / UPDATE statements
// =============================================================================

const stripTicks = (s) => s.replace(/[`"]/g, '').trim().toLowerCase();
const splitExprs = (s) => splitTopLevel(s).map((x) => x.trim()).filter(Boolean);

/** The value of a single-quoted SQL literal, or null for anything else. */
function literalValue(expr) {
  const m = /^'((?:[^'\\]|\\.|'')*)'$/.exec(expr.trim());
  return m ? unquote(m[1]) : null;
}

/** Offset of the top-level FROM in a SELECT projection, or -1. */
function findTopLevelFrom(s) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { if (depth === 0) return -1; depth--; }
    else if (depth === 0 && /\s/.test(ch) && /^\s+FROM\s/i.test(s.slice(i, i + 6))) return i;
  }
  return -1;
}

/**
 * Parse `col = expr, col2 = expr2` up to the first top-level WHERE/ORDER/LIMIT
 * or the end of the statement. Returns null when it cannot be resolved
 * statically (dynamic interpolation, or a shape this parser does not model).
 */
function parseSetClause(text) {
  let depth = 0;
  let quote = null;
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === ';') { end = i; break; }
    if (ch === '(') depth++;
    else if (ch === ')') { if (depth === 0) { end = i; break; } depth--; }
    else if (depth === 0 && /^\s+(?:WHERE|ORDER\s+BY|LIMIT)\s/i.test(text.slice(i, i + 12))) { end = i; break; }
  }
  const clause = text.slice(0, end);
  if (clause.includes(DYN)) return null;

  const assigns = [];
  for (const part of splitTopLevel(clause)) {
    const eq = indexOfTopLevelEquals(part);
    if (eq === -1) return null;
    const col = stripTicks(part.slice(0, eq));
    if (!/^[\w.]+$/.test(col)) return null;
    assigns.push({ col, value: part.slice(eq + 1).trim() });
  }
  return assigns.length > 0 ? assigns : null;
}

function indexOfTopLevelEquals(part) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '=' && depth === 0
      && part[i + 1] !== '=' && !['!', '<', '>', ':'].includes(part[i - 1])) return i;
  }
  return -1;
}

/**
 * Extract INSERT/UPDATE statements from ONE SQL string literal. Everything is
 * clipped to this literal, so a statement can never bleed into the next one.
 */
function extractFromLiteral(rawSql, file, line) {
  const sql = stripSqlComments(rawSql);
  const statements = [];
  const skipped = [];

  // ---------------- INSERT [IGNORE] INTO <table> (<columns>) ----------------
  const insertRe = /INSERT\s+(?:LOW_PRIORITY\s+|HIGH_PRIORITY\s+|DELAYED\s+)?(?:IGNORE\s+)?INTO\s+(\S+)\s*\(/gi;
  let m;
  while ((m = insertRe.exec(sql))) {
    const table = stripTicks(m[1]);
    const bal = readBalanced(sql, m.index + m[0].length - 1);
    if (!bal) { skipped.push({ file, line, why: 'unbalanced INSERT column list' }); break; }
    insertRe.lastIndex = bal.end;

    if (!/^\w+$/.test(table)) {
      skipped.push({ file, line, why: `dynamic table name in INSERT (${m[1].trim()})` });
      continue;
    }
    if (bal.body.includes(DYN)) {
      skipped.push({ file, line, why: `dynamic column list in INSERT INTO ${table}` });
      continue;
    }
    const columns = splitExprs(bal.body).map(stripTicks);
    if (columns.length === 0 || columns.some((c) => !/^\w+$/.test(c))) {
      skipped.push({ file, line, why: `unparseable column list in INSERT INTO ${table}` });
      continue;
    }

    // Positional values: the first VALUES tuple, or the SELECT projection.
    const tail = sql.slice(bal.end + 1);
    let values = null;
    const valuesMatch = /^\s*VALUES?\s*\(/i.exec(tail);
    if (valuesMatch) {
      const vb = readBalanced(tail, valuesMatch[0].length - 1);
      if (vb) values = splitExprs(vb.body);
    } else if (/^\s*SELECT\s/i.test(tail)) {
      const rest = tail.slice(/^\s*SELECT\s/i.exec(tail)[0].length);
      const fromIdx = findTopLevelFrom(rest);
      if (fromIdx > 0) values = splitExprs(rest.slice(0, fromIdx));
    }
    // A length mismatch means the row is assembled dynamically (multi-row VALUES,
    // interpolated tuples, …) — don't guess which value belongs to which column.
    if (values && values.length !== columns.length) values = null;

    statements.push({ kind: 'INSERT', table, columns, values, assigns: null, line, file });

    // ON DUPLICATE KEY UPDATE writes to the same table.
    const odk = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\s+/i.exec(tail);
    if (odk) {
      const assigns = parseSetClause(tail.slice(odk.index + odk[0].length));
      if (assigns === null) skipped.push({ file, line, why: `dynamic ON DUPLICATE KEY UPDATE on ${table}` });
      else statements.push({ kind: 'UPSERT', table, columns: assigns.map((a) => a.col), values: null, assigns, line, file });
    }
  }

  // ---------------- UPDATE <table> [alias] SET ... ----------------
  const updateRe = /\bUPDATE\s+(?!SET\b)([^\s,;()]+)([\s\S]{0,120}?)\bSET\b/gi;
  while ((m = updateRe.exec(sql))) {
    // ON DUPLICATE KEY UPDATE is handled above, not here.
    if (/\bDUPLICATE\s+KEY\s+$/i.test(sql.slice(Math.max(0, m.index - 24), m.index))) continue;

    const table = stripTicks(m[1]);
    const between = m[2];

    if (!/^\w+$/.test(table)) {
      skipped.push({ file, line, why: `dynamic table name in UPDATE (${m[1].trim()})` });
      continue;
    }
    if (/\bJOIN\b|,/i.test(between)) {
      skipped.push({ file, line, why: `multi-table UPDATE ${table} — columns not statically attributable` });
      continue;
    }

    const aliasMatch = /^\s*(?:AS\s+)?[`"]?(\w+)[`"]?\s*$/i.exec(between);
    const alias = aliasMatch && !NOT_AN_ALIAS.has(aliasMatch[1].toLowerCase())
      ? aliasMatch[1].toLowerCase()
      : null;

    const assigns = parseSetClause(sql.slice(m.index + m[0].length));
    if (assigns === null) {
      skipped.push({ file, line, why: `dynamic SET clause in UPDATE ${table}` });
      continue;
    }

    const resolved = [];
    let bail = false;
    for (const a of assigns) {
      const dot = a.col.indexOf('.');
      if (dot === -1) { resolved.push(a); continue; }
      const qualifier = a.col.slice(0, dot);
      if (qualifier === table || (alias && qualifier === alias)) {
        resolved.push({ col: a.col.slice(dot + 1), value: a.value });
      } else {
        skipped.push({ file, line, why: `UPDATE ${table}: unresolvable qualifier "${qualifier}"` });
        bail = true;
        break;
      }
    }
    if (bail) continue;

    statements.push({ kind: 'UPDATE', table, columns: resolved.map((a) => a.col), values: null, assigns: resolved, line, file });
  }

  return { statements, skipped };
}

// =============================================================================
// 3b. SELECT-statement column references (WHERE / SELECT-list / JOIN...ON /
//     ORDER BY / GROUP BY) — deliberately pragmatic, NOT a SQL parser.
// =============================================================================
// This is what catches drift like `suspension_rules.is_enabled` (real column:
// is_active) — a bug the INSERT/UPDATE checks above cannot see at all, because
// nothing was being written; the query simply matched zero rows, forever,
// silently.
//
// Attempted only for a literal that IS a top-level SELECT statement (starts,
// after whitespace, with SELECT) whose FROM/JOIN targets are all literal table
// names — never a derived table/subquery. If the statement contains a nested
// `(SELECT ...)` anywhere in scope, the whole statement is skipped rather than
// guessing which table an identifier inside it belongs to.
//
// Two kinds of reference are checked:
//   - QUALIFIED (`alias.column` / `table.column`) — checked anywhere in the
//     statement (SELECT list, JOIN...ON, WHERE, GROUP BY, ORDER BY, even
//     inside function-call arguments) once the alias resolves to a table.
//   - BARE (`column`) — only for a single-table statement (no JOIN): a bare
//     identifier in a multi-table query is ambiguous, and is skipped rather
//     than guessed.
//
// An identifier immediately followed by `(` is a function call, not a column
// — that one rule excludes NOW(), COUNT(*), DATEDIFF(...), COALESCE(...), etc.
// generically, with no function-name list to maintain. A bare identifier
// immediately preceded by `AS` is a projection alias, not a source column.

const SQL_BARE_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'like',
  'between', 'order', 'by', 'group', 'having', 'limit', 'offset', 'asc', 'desc',
  'as', 'on', 'using', 'join', 'inner', 'left', 'right', 'outer', 'cross',
  'straight_join', 'union', 'all', 'distinct', 'case', 'when', 'then', 'else',
  'end', 'exists', 'true', 'false', 'default', 'values', 'into', 'set', 'for',
  'lock', 'share', 'mode', 'with', 'recursive', 'interval', 'binary',
  'update',   // `SELECT ... FOR UPDATE` row-locking suffix, not a column
  'day', 'days', 'month', 'months', 'year', 'years', 'hour', 'hours',
  'minute', 'minutes', 'second', 'seconds', 'microsecond', 'week', 'weeks', 'quarter',
]);

/** Find the top-level (paren depth 0) `FROM` keyword. Returns {start, end} or null. */
function findTopLevelFromWord(s) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { if (depth === 0) return null; depth--; continue; }
    if (depth !== 0) continue;
    if (/^FROM\b/i.test(s.slice(i)) && (i === 0 || !/\w/.test(s[i - 1]))) {
      return { start: i, end: i + 4 };
    }
  }
  return null;
}

/**
 * Find the next top-level (paren depth 0, relative to `start`) whole-word
 * occurrence of any of `keywords`, starting at `start`. Returns the index, or
 * `text.length` if none is found before the end (or before leaving scope via
 * an unmatched ')').
 */
function findNextTopLevelBoundary(text, keywords, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { if (depth === 0) return i; depth--; continue; }
    if (depth !== 0 || !/[A-Za-z_]/.test(ch)) continue;
    if (i > start && /\w/.test(text[i - 1])) continue;
    for (const kw of keywords) {
      if (text.slice(i, i + kw.length).toLowerCase() === kw && !/\w/.test(text[i + kw.length] || '')) {
        return i;
      }
    }
  }
  return text.length;
}

const JOIN_BOUNDARY = /^(JOIN|INNER|LEFT|RIGHT|CROSS|STRAIGHT_JOIN|WHERE|GROUP|ORDER|HAVING|LIMIT|ON|USING|UNION)\b/i;

/**
 * Parse `<table1> [[AS] alias1] (JOIN <table2> [[AS] alias2] ON <cond>)*`
 * starting at index 0 of `region` (everything after the FROM keyword).
 * Returns null — bail, don't guess — if any target isn't a literal table name
 * (a derived table / subquery) or a JOIN isn't a plain `... ON <cond>` (e.g.
 * `USING (...)`, which this pass does not model).
 *
 * @returns {{aliases: Map<string,string>, onClauses: string[], end: number, tableCount: number}}
 */
function parseFromJoinList(region) {
  const aliases = new Map();
  const onClauses = [];
  let tableCount = 0;
  let i = 0;

  const skipWs = () => { while (i < region.length && /\s/.test(region[i])) i++; };
  const readIdent = () => {
    skipWs();
    const m = /^[`"]?(\w+)[`"]?/.exec(region.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[1].toLowerCase();
  };
  const readOptionalAlias = (fallback) => {
    skipWs();
    if (/^AS\b/i.test(region.slice(i))) { i += 2; const a = readIdent(); return a || fallback; }
    if (/^[A-Za-z_]\w*/.test(region.slice(i)) && !JOIN_BOUNDARY.test(region.slice(i))) {
      const a = readIdent();
      return a || fallback;
    }
    return fallback;
  };

  skipWs();
  if (region[i] === '(') return null;              // derived table — bail
  const firstTable = readIdent();
  if (!firstTable) return null;
  tableCount++;
  const firstAlias = readOptionalAlias(firstTable);
  aliases.set(firstAlias, firstTable);
  aliases.set(firstTable, firstTable);

  for (;;) {
    skipWs();
    const joinMatch = /^(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|STRAIGHT_JOIN|JOIN)\b/i.exec(region.slice(i));
    if (!joinMatch) break;
    i += joinMatch[0].length;
    skipWs();
    if (region[i] === '(') return null;            // derived table — bail
    const table = readIdent();
    if (!table) return null;
    tableCount++;
    const jAlias = readOptionalAlias(table);
    aliases.set(jAlias, table);
    aliases.set(table, table);

    skipWs();
    if (!/^ON\b/i.test(region.slice(i))) return null;   // USING(...) or malformed — bail
    i += 2;
    const onStart = i;
    const onEnd = findNextTopLevelBoundary(
      region, ['join', 'inner', 'left', 'right', 'cross', 'straight_join', 'where', 'group', 'order', 'having', 'limit'], i,
    );
    onClauses.push(region.slice(onStart, onEnd));
    i = onEnd;
  }

  return { aliases, onClauses, end: i, tableCount };
}

/**
 * Quote-and-backtick-aware scan of `text` for column references, checking
 * each one found against `ctx.tables`. Mutates `ctx.errors` and
 * `ctx.refCounter`.
 */
function scanColumnRefs(text, ctx) {
  const isIdentStart = (c) => c !== undefined && /[A-Za-z_]/.test(c);
  const isIdentChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  let i = 0;
  let quote = null;

  const checkColumn = (table, lname, displayRef, tokenStart) => {
    const schema = ctx.tables.get(table);
    if (!schema) return;                   // unknown/external table — not ours to check
    if (SQL_BARE_KEYWORDS.has(lname)) return;
    ctx.refCounter.count++;
    if (!schema.columns.has(lname)) {
      if (isGuardedSelectException(ctx.file, table, lname)) return;
      if (isKnownGap({ file: ctx.file, table }, lname)) {
        ctx.gaps.push(`${ctx.file}:${ctx.line}  SELECT ${table}.${lname}`);
        return;
      }
      ctx.errors.push(
        `${ctx.file}:${ctx.line}  SELECT ${table} — column "${lname}" does not exist `
        + `(database/schema.sql), referenced as ${displayRef}`,
      );
    }
    void tokenStart;
  };

  const handleToken = (name, start, end, qualifier) => {
    // The literal marker for a masked `${…}` interpolation is `@@DYN@@`. As a
    // BARE token its word is `DYN` (the `@` characters are not identifier
    // characters, so they fall away on either side); inside backticks
    // (`` `${expr}` `` — a dynamic quoted identifier) the whole `@@DYN@@`
    // string is read as one token, `@` included. Either shape looks like a
    // legal identifier and would otherwise always fail the check.
    if (name === 'DYN' || name === DYN) return;
    let k = end;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === '(') return;                                    // function call
    const before = text.slice(Math.max(0, start - 24), start);
    if (/\bAS\s+$/i.test(before)) return;                            // projection alias, not a source column
    const lname = name.toLowerCase();
    if (qualifier) {
      const table = ctx.aliasMap.get(qualifier.toLowerCase());
      if (!table) return;                                            // unresolved qualifier — don't guess
      checkColumn(table, lname, `${qualifier}.${name}`, start);
    } else {
      if (ctx.projectionAliases && ctx.projectionAliases.has(lname)) return;  // ORDER/GROUP BY a SELECT-list alias
      if (!ctx.soleTable) return;                                    // multi-table query — ambiguous, don't guess
      checkColumn(ctx.soleTable, lname, name, start);
    }
  };

  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; i++; continue; }
    if (ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== '`') j++;
      handleToken(text.slice(i + 1, j), i, j + 1, null);
      i = j + 1;
      continue;
    }
    if (!isIdentStart(ch)) { i++; continue; }
    let j = i + 1;
    while (isIdentChar(text[j])) j++;
    const word = text.slice(i, j);

    // `alias.*` (e.g. `SELECT c.*, i.id FROM contracts c JOIN invoices i ...`)
    // is not a column reference at all — critically, it must NOT fall through
    // to being checked as a BARE reference to the alias letter itself (`c`,
    // `d`, `r`, …), which is what happened before this guard existed.
    if (text[j] === '.' && text[j + 1] === '*') { i = j + 2; continue; }

    let qualifier = null;
    let name = word;
    let tokenEnd = j;
    if (text[j] === '.') {
      if (text[j + 1] === '`') {
        let j2 = j + 2;
        while (j2 < text.length && text[j2] !== '`') j2++;
        qualifier = word; name = text.slice(j + 2, j2); tokenEnd = j2 + 1;
      } else if (isIdentStart(text[j + 1])) {
        let j2 = j + 2;
        while (isIdentChar(text[j2])) j2++;
        qualifier = word; name = text.slice(j + 1, j2); tokenEnd = j2;
      }
    }
    handleToken(name, i, tokenEnd, qualifier);
    i = tokenEnd;
  }
}

/**
 * Check a top-level SELECT statement's column references outside the
 * (already separately handled) INSERT/UPDATE column lists.
 */
function extractSelectRefs(rawSql, file, line, tables) {
  const result = { errors: [], skipped: [], gaps: [], attempted: false, refCount: 0 };
  if (!/^\s*SELECT\b/i.test(rawSql)) return result;
  result.attempted = true;

  // Same fix as extractFromLiteral: SQL `-- comment` / `# comment` text must
  // not be scanned as identifiers (a `-- 15-minute window: SNMP poller ...`
  // comment produced bogus "column does not exist" hits for every English
  // word in it before this was here).
  const sql = stripSqlComments(rawSql);

  const selMatch = /^\s*SELECT\b\s*/i.exec(sql);
  if (!selMatch) { result.attempted = false; return result; }
  const afterSelect = sql.slice(selMatch[0].length);
  const fromWord = findTopLevelFromWord(afterSelect);
  if (!fromWord) {
    result.skipped.push({ file, line, why: 'top-level SELECT with no resolvable top-level FROM' });
    return result;
  }
  const projection = afterSelect.slice(0, fromWord.start);
  const afterFrom = afterSelect.slice(fromWord.end);

  const parsed = parseFromJoinList(afterFrom);
  if (!parsed) {
    result.skipped.push({
      file, line,
      // Deliberately NOT worded "SELECT ... FROM ..." — this string is itself
      // scanned by the same SELECT-detector that reports it (this file is
      // under src/), and it was misidentified as a real query (`FROM target`)
      // by its own checker before this rewording.
      why: 'the FROM target is not a plain table name (derived table/subquery, or an unrecognised JOIN shape e.g. USING(...))',
    });
    return result;
  }

  const tail = afterFrom.slice(parsed.end);
  if (/\(\s*SELECT\b/i.test(projection) || parsed.onClauses.some((c) => /\(\s*SELECT\b/i.test(c)) || /\(\s*SELECT\b/i.test(tail)) {
    result.skipped.push({ file, line, why: 'nested subquery present — not descended into' });
    return result;
  }
  // A top-level UNION means the tail also contains a SECOND, independent
  // SELECT...FROM... statement (its own tables/aliases) — scanning `tail` as
  // if it all belonged to THIS statement's single table would misattribute
  // the other statement's own FROM target and columns as bare references here.
  if (findNextTopLevelBoundary(tail, ['union'], 0) < tail.length) {
    result.skipped.push({ file, line, why: 'UNION — the combined statement is not descended into' });
    return result;
  }

  // Every FROM/JOIN target must be a real table. Column-existence checks
  // below silently no-op for an unresolvable table (`ctx.tables.get(table)`
  // returns undefined) — which means a query against a table that was NEVER
  // CREATED (not a typo'd column, the whole table doesn't exist) would
  // otherwise pass with zero column refs checked and zero errors. That is
  // exactly how `onu_devices`, `alerts` (real: alert_events) and
  // `client_billing_summaries` (never existed) went unnoticed.
  for (const table of new Set(parsed.aliases.values())) {
    if (!tables.has(table) && !EXTERNAL_TABLES.has(table)) {
      if (isKnownMissingTable(file, table)) {
        result.gaps.push(`${file}:${line}  SELECT — table "${table}" does not exist in database/schema.sql`);
      } else {
        result.errors.push(`${file}:${line}  SELECT — table "${table}" does not exist in database/schema.sql`);
      }
    }
  }

  const soleTable = parsed.tableCount === 1 ? [...new Set(parsed.aliases.values())][0] : null;

  // MySQL allows ORDER BY / GROUP BY / HAVING to reference a SELECT-list alias
  // bare (`… AS usage_date … ORDER BY usage_date`) — that is legal SQL, not a
  // missing column, so projection aliases are collected up front and excluded
  // from the bare-identifier check in the tail.
  const projectionAliases = new Set();
  const aliasRe = /\bAS\s+[`"]?(\w+)[`"]?/gi;
  let am;
  while ((am = aliasRe.exec(projection))) projectionAliases.add(am[1].toLowerCase());

  const ctx = {
    file, line, tables, aliasMap: parsed.aliases, soleTable, projectionAliases,
    errors: result.errors, gaps: result.gaps, refCounter: { count: 0 },
  };

  scanColumnRefs(projection, ctx);
  for (const onClause of parsed.onClauses) scanColumnRefs(onClause, ctx);
  scanColumnRefs(tail, ctx);

  result.refCount = ctx.refCounter.count;
  return result;
}

// =============================================================================
// 4. Runner
// =============================================================================

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function checkStatement(st, tables, errors, gaps) {
  const schema = tables.get(st.table);
  if (!schema) {
    if (!EXTERNAL_TABLES.has(st.table)) {
      errors.push(`${st.file}:${st.line}  ${st.kind} ${st.table} — table does not exist in database/schema.sql`);
    }
    return false;
  }

  for (const col of st.columns) {
    if (!schema.columns.has(col)) {
      if (isKnownGap(st, col)) {
        gaps.push(`${st.file}:${st.line}  ${st.kind} ${st.table}.${col}`);
        continue;
      }
      errors.push(`${st.file}:${st.line}  ${st.kind} ${st.table} — column "${col}" does not exist (database/schema.sql)`);
      continue;
    }
    // The column exists, but MySQL rejects ANY explicit value for a
    // `GENERATED ALWAYS AS (...) STORED|VIRTUAL` column
    // (ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN) — writing one is just as
    // dead as writing a column that doesn't exist at all (see
    // credit_note_items.total / quote_items.total).
    if (schema.generated.has(col)) {
      errors.push(`${st.file}:${st.line}  ${st.kind} ${st.table}.${col} — GENERATED column, cannot be written`);
    }
  }

  // ENUM validation for statically visible single-quoted literals only.
  let enumChecks = 0;
  const pairs = [];
  if (st.values) st.columns.forEach((col, idx) => pairs.push([col, st.values[idx]]));
  if (st.assigns) st.assigns.forEach((a) => pairs.push([a.col, a.value]));
  for (const [col, expr] of pairs) {
    if (!expr) continue;
    const allowed = schema.enums.get(col);
    if (!allowed) continue;
    const value = literalValue(expr);
    if (value === null) continue;                 // bound param / expression
    enumChecks++;
    if (!allowed.has(value)) {
      errors.push(
        `${st.file}:${st.line}  ${st.kind} ${st.table}.${col} = '${value}' — not a value of `
        + `ENUM(${[...allowed].map((v) => `'${v}'`).join(',')})`,
      );
    }
  }
  return enumChecks;
}

function run({ verbose = false, log = console.log } = {}) {
  const tables = parseSchema(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const files = walk(SRC_DIR).sort();

  const errors = [];
  const skipped = [];
  const notScanned = [];
  const gaps = [];
  let insertCount = 0;
  let updateCount = 0;
  let enumCount = 0;
  let selectChecked = 0;
  let selectSkipped = 0;
  let selectRefCount = 0;

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const scan = scanLiterals(fs.readFileSync(file, 'utf8'));
    if (!scan) { notScanned.push(rel); continue; }

    for (const lit of scan.literals) {
      if (/\b(INSERT\s+(?:LOW_PRIORITY\s+|HIGH_PRIORITY\s+|DELAYED\s+)?(?:IGNORE\s+)?INTO|UPDATE)\b/i.test(lit.text)) {
        const { statements, skipped: litSkipped } = extractFromLiteral(lit.text, rel, lit.line);
        skipped.push(...litSkipped);
        for (const st of statements) {
          const enumChecks = checkStatement(st, tables, errors, gaps);
          if (enumChecks === false) continue;      // unknown table
          if (st.kind === 'INSERT') insertCount++;
          else updateCount++;
          enumCount += enumChecks;
        }
      }

      // SELECT column-reference pass — independent of the INSERT/UPDATE pass
      // above (a literal is either an INSERT/UPDATE or a top-level SELECT,
      // never both: INSERT...SELECT starts with INSERT and is handled above).
      if (/^\s*SELECT\b/i.test(lit.text)) {
        const selResult = extractSelectRefs(lit.text, rel, lit.line, tables);
        if (selResult.attempted) {
          if (selResult.skipped.length > 0) {
            selectSkipped++;
            skipped.push(...selResult.skipped);
          } else {
            selectChecked++;
            selectRefCount += selResult.refCount;
            errors.push(...selResult.errors);
            gaps.push(...selResult.gaps);
          }
        }
      }
    }
  }

  log('SQL column check — src/**/*.js vs database/schema.sql');
  log(`  tables in schema.sql:   ${tables.size}`);
  log(`  statements checked:     ${insertCount + updateCount} (INSERT ${insertCount}, UPDATE/UPSERT ${updateCount})`);
  log(`  ENUM literals checked:  ${enumCount}`);
  log(`  SELECT statements:      ${selectChecked} checked (${selectRefCount} column refs), ${selectSkipped} skipped (unresolvable FROM/JOIN or nested subquery)`);
  log(`  skipped (dynamic SQL):  ${skipped.length}${verbose ? '' : '  [--verbose to list]'}`);
  if (notScanned.length > 0) log(`  files not scanned:      ${notScanned.length} — ${notScanned.join(', ')}`);
  if (verbose) for (const s of skipped) log(`    SKIP ${s.file}:${s.line}  ${s.why}`);

  if (gaps.length > 0) {
    log('');
    log(`KNOWN SCHEMA GAPS — ${gaps.length} statement(s) still broken in production, not gated:`);
    for (const g of KNOWN_SCHEMA_GAPS) {
      log(`  ${g.file} → ${g.table}.{${g.columns.join(', ')}}`);
      log(`    ${g.why}`);
    }
    for (const g of KNOWN_MISSING_TABLES) {
      log(`  ${g.file} → table "${g.table}" (does not exist)`);
      log(`    ${g.why}`);
    }
  }

  if (RUNTIME_GUARDED_SELECT_EXCEPTIONS.length > 0) {
    log('');
    log(`RUNTIME-GUARDED SELECT EXCEPTIONS — ${RUNTIME_GUARDED_SELECT_EXCEPTIONS.length} verified-safe (not a gap, no migration needed):`);
    for (const g of RUNTIME_GUARDED_SELECT_EXCEPTIONS) {
      log(`  ${g.file} → ${g.table}.{${g.columns.join(', ')}}`);
      log(`    ${g.why}`);
    }
  }

  if (errors.length > 0) {
    log('');
    for (const e of errors) log(`ERROR ${e}`);
    log('');
    log(`SQL column check FAILED — ${errors.length} problem(s).`);
    log('Column names are the API contract: fix the code, not the schema.');
  } else {
    log('SQL column check passed — no column or ENUM drift.');
  }

  return {
    errors, skipped, notScanned, gaps, insertCount, updateCount, enumCount,
    selectChecked, selectSkipped, selectRefCount, tables,
  };
}

if (require.main === module) {
  const result = run({ verbose: process.argv.includes('--verbose') });
  process.exit(result.errors.length > 0 ? 1 : 0);
}

module.exports = {
  run, parseSchema, scanLiterals, extractFromLiteral, parseSetClause, literalValue,
  extractSelectRefs, parseFromJoinList, scanColumnRefs,
  KNOWN_SCHEMA_GAPS, RUNTIME_GUARDED_SELECT_EXCEPTIONS, KNOWN_MISSING_TABLES,
};
