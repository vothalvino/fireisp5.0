// =============================================================================
// FireISP 5.0 — One-off data repair: decode entity-encoded free-text fields
// =============================================================================
// Historical context: the global input-sanitization middleware
// (src/middleware/sanitize.js, removed alongside this script) used to
// HTML-entity-encode every string in every request body before it reached
// validation or storage — turning `'` into `&#x27;`, `&` into `&amp;`, etc.
// Free-text VARCHAR/TEXT columns silently accepted and PERMANENTLY STORED
// that corrupted text (e.g. a client named "O'Brien" got stored as
// "O&#x27;Brien"). JSON-typed columns did NOT get corrupted this way — MySQL's
// JSON validator rejected the malformed JSON at INSERT/UPDATE time, so those
// writes 500'd instead of persisting; there is nothing to repair there.
//
// This script finds and decodes the 5 entities the old middleware produced,
// for the free-text columns most likely to have been affected. It is a
// STANDALONE, MANUALLY-RUN maintenance script — it is intentionally NOT
// registered in src/services/taskRunner.js and must never run automatically.
//
// IMPORTANT: run this AFTER the sanitize.js removal has deployed. Running it
// before just means newly-entered legitimate data (if any literally contains
// the exact substring "&amp;" typed by a user, e.g. copy-pasted from HTML)
// could be mistaken for the bug artifact and get decoded too — there is no
// way to distinguish "the bug produced this" from "a user genuinely typed
// this exact entity string" after the fact. This is a small, accepted
// false-positive risk described in the fix's PR.
//
// Usage:
//   node src/scripts/repair-entity-encoded-fields.js              # dry run (default)
//   node src/scripts/repair-entity-encoded-fields.js --dry-run    # same, explicit
//   node src/scripts/repair-entity-encoded-fields.js --apply      # actually write
//
// CFDI documents: `cfdi_documents.receptor_nombre` is auto-repaired ONLY for
// draft/unstamped rows (uuid IS NULL). Rows that were already stamped by a
// PAC (uuid IS NOT NULL) are a compliance question, not a mechanical fix —
// their legal receptor_nombre was filed with the SAT as-is. This script
// never writes to a stamped row; it only prints them for a human
// (finance/compliance) decision on cancellation + refiling.
// =============================================================================

require('dotenv').config();
const db = require('../config/database');
const logger = require('../utils/logger').child({ script: 'repair-entity-encoded-fields' });

// Curated candidate list of free-text columns a human can type apostrophes,
// ampersands, or angle brackets into. Not an exhaustive sweep of every
// VARCHAR/TEXT column in schema.sql — deliberately scoped to columns that are
// (a) free-form staff/customer-entered text and (b) not already covered by a
// stricter validator (e.g. RFC/email/phone columns, which don't take these
// characters as valid input in the first place).
const TARGETS = [
  { table: 'clients', columns: ['name', 'notes', 'address', 'suspension_exempt_reason'] },
  { table: 'leads', columns: ['name', 'company', 'address', 'city', 'state', 'notes'] },
  { table: 'tickets', columns: ['subject', 'description', 'notes'] },
  { table: 'portal_kb_articles', columns: ['title', 'body'] },
  { table: 'message_templates', columns: ['subject', 'body', 'description'] },
  // cfdi_documents is handled separately below — auto-repair is conditional
  // on `uuid IS NULL` (draft/unstamped), never on stamped rows.
];

const CFDI_TABLE = 'cfdi_documents';
const CFDI_COLUMN = 'receptor_nombre';

// The 5 entities the old middleware produced (src/middleware/sanitize.js,
// now removed). Decode &amp; LAST so a literal "&amp;amp;" (which would only
// occur if something double-encoded) doesn't get mis-collapsed into "&amp;"
// instead of "&".
const ENTITY_DECODES = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#x27;/g, "'"],
  [/&amp;/g, '&'],
];

function decodeEntities(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [pattern, replacement] of ENTITY_DECODES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function isCorrupted(value) {
  return typeof value === 'string' && /&(amp|lt|gt|quot|#x27);/.test(value);
}

async function repairColumn(table, column, { apply }) {
  const [rows] = await db.query(
    `SELECT id, \`${column}\` AS val FROM \`${table}\`
     WHERE \`${column}\` LIKE '%&amp;%' OR \`${column}\` LIKE '%&lt;%'
        OR \`${column}\` LIKE '%&gt;%' OR \`${column}\` LIKE '%&quot;%'
        OR \`${column}\` LIKE '%&#x27;%'`,
  );

  const candidates = rows.filter((r) => isCorrupted(r.val));
  if (candidates.length === 0) return { table, column, count: 0 };

  logger.info({ table, column, count: candidates.length }, apply ? 'Repairing rows' : 'Would repair rows (dry run)');
  for (const row of candidates.slice(0, 5)) {
    const decoded = decodeEntities(row.val);
    console.log(`  [${table}.${column}#${row.id}]\n    before: ${JSON.stringify(row.val)}\n    after:  ${JSON.stringify(decoded)}`);
  }
  if (candidates.length > 5) {
    console.log(`  ... and ${candidates.length - 5} more`);
  }

  if (apply) {
    for (const row of candidates) {
      const decoded = decodeEntities(row.val);
      await db.query(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE id = ?`, [decoded, row.id]);
    }
  }

  return { table, column, count: candidates.length };
}

async function repairCfdiReceptorNombre({ apply }) {
  const [rows] = await db.query(
    `SELECT id, uuid, \`${CFDI_COLUMN}\` AS val FROM \`${CFDI_TABLE}\`
     WHERE \`${CFDI_COLUMN}\` LIKE '%&amp;%' OR \`${CFDI_COLUMN}\` LIKE '%&lt;%'
        OR \`${CFDI_COLUMN}\` LIKE '%&gt;%' OR \`${CFDI_COLUMN}\` LIKE '%&quot;%'
        OR \`${CFDI_COLUMN}\` LIKE '%&#x27;%'`,
  );

  const candidates = rows.filter((r) => isCorrupted(r.val));
  const draftRows = candidates.filter((r) => r.uuid === null);
  const stampedRows = candidates.filter((r) => r.uuid !== null);

  if (draftRows.length > 0) {
    logger.info({ count: draftRows.length }, apply ? 'Repairing draft cfdi_documents.receptor_nombre rows' : 'Would repair draft cfdi_documents.receptor_nombre rows (dry run)');
    for (const row of draftRows) {
      const decoded = decodeEntities(row.val);
      console.log(`  [cfdi_documents.receptor_nombre#${row.id}] before: ${JSON.stringify(row.val)} after: ${JSON.stringify(decoded)}`);
      if (apply) {
        await db.query('UPDATE cfdi_documents SET receptor_nombre = ? WHERE id = ?', [decoded, row.id]);
      }
    }
  }

  if (stampedRows.length > 0) {
    console.log('');
    console.log(`  *** ${stampedRows.length} STAMPED cfdi_documents row(s) have a corrupted receptor_nombre and were NOT touched: ***`);
    for (const row of stampedRows) {
      console.log(`    id=${row.id} uuid=${row.uuid} receptor_nombre=${JSON.stringify(row.val)}`);
    }
    console.log('  These were already filed with the SAT under the corrupted legal name. This');
    console.log('  script never auto-repairs a stamped CFDI — flag to finance/compliance for a');
    console.log('  cancellation + refiling decision.');
  }

  return { draftRepaired: draftRows.length, stampedFlagged: stampedRows.length };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  console.log(apply ? 'Running in APPLY mode — rows will be updated.' : 'Running in DRY-RUN mode (default). Pass --apply to write changes.');
  console.log('');

  let totalRepaired = 0;

  for (const { table, columns } of TARGETS) {
    for (const column of columns) {
      const result = await repairColumn(table, column, { apply });
      totalRepaired += result.count;
    }
  }

  const cfdiResult = await repairCfdiReceptorNombre({ apply });
  totalRepaired += cfdiResult.draftRepaired;

  console.log('');
  console.log(`Done. ${apply ? 'Repaired' : 'Would repair'} ${totalRepaired} row(s)${cfdiResult.stampedFlagged ? `; ${cfdiResult.stampedFlagged} stamped CFDI row(s) flagged for manual review` : ''}.`);
  if (!apply && totalRepaired > 0) {
    console.log('Re-run with --apply to write these changes.');
  }

  await db.close();
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'repair-entity-encoded-fields failed');
    process.exitCode = 1;
  });
}

module.exports = { decodeEntities, isCorrupted, TARGETS, repairColumn, repairCfdiReceptorNombre };
