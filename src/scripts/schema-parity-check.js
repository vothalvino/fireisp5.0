// =============================================================================
// FireISP 5.0 — Offline schema.sql parity check (no database required)
// =============================================================================
// Simulates migration-smoke-test.js column parity locally: expected columns =
// union of CREATE TABLE bodies + ADD COLUMN ALTERs across all migrations
// (DROP/CHANGE COLUMN handled heuristically). Compares against schema.sql.
// The CI smoke test against a live database remains the authority.
//
// Usage:  node src/scripts/schema-parity-check.js   (exit 1 on any mismatch)
const fs = require('fs');
const path = require('path');
const { extractSchemaColumns } = require(path.resolve('src/scripts/migration-smoke-test.js'));

const dbCols = new Map(); // table -> Set(cols) per migrations
const files = fs.readdirSync('database/migrations').filter(f => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = fs.readFileSync(path.join('database/migrations', f), 'utf8');
  // CREATE TABLE bodies via the real smoke-test parser
  for (const [t, cols] of extractSchemaColumns(sql)) {
    if (!dbCols.has(t)) dbCols.set(t, new Set());
    for (const c of cols) dbCols.get(t).add(c);
  }
  // ADD COLUMN statements
  const re = /ALTER TABLE\s+`?(\w+)`?[\s\S]{0,200}?ADD COLUMN\s+`?(\w+)`?/gi;
  let m;
  while ((m = re.exec(sql))) {
    const t = m[1].toLowerCase(), c = m[2].toLowerCase();
    if (/^[,'"]/.test(m[1])) continue; // dynamic SQL fragments
    if (!dbCols.has(t)) dbCols.set(t, new Set());
    dbCols.get(t).add(c);
  }
  // DROP COLUMN (e.g. migration 188 drops ip_pools.cidr)
  const reDrop = /ALTER TABLE\s+`?(\w+)`?[\s\S]{0,200}?DROP COLUMN\s+`?(\w+)`?/gi;
  while ((m = reDrop.exec(sql))) {
    const t = m[1].toLowerCase(), c = m[2].toLowerCase();
    if (dbCols.has(t)) dbCols.get(t).delete(c);
  }
  // CHANGE COLUMN old new (renames)
  const reChg = /ALTER TABLE\s+`?(\w+)`?[\s\S]{0,200}?CHANGE COLUMN\s+`?(\w+)`?\s+`?(\w+)`?/gi;
  while ((m = reChg.exec(sql))) {
    const t = m[1].toLowerCase();
    if (dbCols.has(t)) { dbCols.get(t).delete(m[2].toLowerCase()); dbCols.get(t).add(m[3].toLowerCase()); }
  }
  // DROP TABLE (e.g. migration 363 consolidates jobs into work_orders)
  const reDropTbl = /DROP TABLE\s+(?:IF EXISTS\s+)?`?(\w+)`?/gi;
  while ((m = reDropTbl.exec(sql))) {
    dbCols.delete(m[1].toLowerCase());
  }
}

const schemaCols = extractSchemaColumns(fs.readFileSync('database/schema.sql', 'utf8'));
let fails = 0;
for (const [t, cols] of dbCols) {
  if (t === 'schema_migrations') continue;
  const sc = schemaCols.get(t);
  if (!sc) { console.log('TABLE MISSING FROM SCHEMA.SQL:', t); fails++; continue; }
  for (const c of cols) {
    if (!sc.has(c)) { console.log('COLUMN MISSING FROM SCHEMA.SQL:', t + '.' + c); fails++; }
  }
}
console.log('local smoke simulation done — failures:', fails);
process.exit(fails ? 1 : 0);
