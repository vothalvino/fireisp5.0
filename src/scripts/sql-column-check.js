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

// Tables the app talks to that are intentionally NOT in schema.sql: FreeRADIUS
// owns its own schema and lives in a separate database when configured.
const EXTERNAL_TABLES = new Set([
  'radcheck', 'radreply', 'radusergroup', 'radgroupcheck', 'radgroupreply',
  'radacct', 'radpostauth',
]);

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
const KNOWN_SCHEMA_GAPS = [
  {
    file: 'src/services/authService.js',
    table: 'users',
    columns: ['reset_token_hash', 'reset_token_expires', 'email_verified_at', 'email_verify_token_hash'],
    why: 'password reset + email verification have NO storage: POST /auth/forgot-password, '
       + '/auth/reset-password and /auth/verify-email 500 on every call. Needs a migration '
       + 'adding these four columns to `users` (or a password_resets table).',
  },
];

function isKnownGap(st, column) {
  return KNOWN_SCHEMA_GAPS.some(
    (g) => g.file === st.file && g.table === st.table && g.columns.includes(column),
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
    const entry = tables.get(table) || { columns: new Set(), enums: new Map() };
    for (const raw of splitTopLevel(bal.body)) {
      const def = raw.trim();
      if (!def || NON_COLUMN_KEYWORDS.test(def)) continue;
      const nameMatch = /^[`"]?(\w+)[`"]?\s+/.exec(def);
      if (!nameMatch) continue;
      const col = nameMatch[1].toLowerCase();
      entry.columns.add(col);                       // includes GENERATED columns
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
        if (c === '\\') { text += c + (src[j + 1] ?? ''); j += 2; continue; }
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
    if (schema.columns.has(col)) continue;
    if (isKnownGap(st, col)) {
      gaps.push(`${st.file}:${st.line}  ${st.kind} ${st.table}.${col}`);
      continue;
    }
    errors.push(`${st.file}:${st.line}  ${st.kind} ${st.table} — column "${col}" does not exist (database/schema.sql)`);
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

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const scan = scanLiterals(fs.readFileSync(file, 'utf8'));
    if (!scan) { notScanned.push(rel); continue; }

    for (const lit of scan.literals) {
      if (!/\b(INSERT\s+(?:LOW_PRIORITY\s+|HIGH_PRIORITY\s+|DELAYED\s+)?(?:IGNORE\s+)?INTO|UPDATE)\b/i.test(lit.text)) continue;
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
  }

  log('SQL column check — src/**/*.js vs database/schema.sql');
  log(`  tables in schema.sql:   ${tables.size}`);
  log(`  statements checked:     ${insertCount + updateCount} (INSERT ${insertCount}, UPDATE/UPSERT ${updateCount})`);
  log(`  ENUM literals checked:  ${enumCount}`);
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

  return { errors, skipped, notScanned, gaps, insertCount, updateCount, enumCount, tables };
}

if (require.main === module) {
  const result = run({ verbose: process.argv.includes('--verbose') });
  process.exit(result.errors.length > 0 ? 1 : 0);
}

module.exports = {
  run, parseSchema, scanLiterals, extractFromLiteral, parseSetClause, literalValue,
  KNOWN_SCHEMA_GAPS,
};
