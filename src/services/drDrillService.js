// =============================================================================
// FireISP 5.0 — DR Drill Service
// =============================================================================
// Runs the automated quarterly DR drill.  The drill is NON-DESTRUCTIVE and
// safe to execute on a live production server:
//
//   Phase 1 — Take a mysqldump backup via the backup script.
//              Verify the compressed file size is > 1 MB.
//
//   Phase 4 — Run referential-integrity and financial-consistency queries
//              against the LIVE database (the same checks documented in
//              docs/dr-drill.md §4a–4c).
//
// Phases 2 (drop) and 3 (restore) are intentionally manual: they must be
// carried out by an on-call engineer against a test environment per the
// runbook in docs/dr-drill.md.
//
// Results are persisted in the dr_drill_logs table.  The /dr-drill/status
// API endpoint exposes the latest result plus an "overdue" flag so the
// admin frontend can warn operators at login time.
// =============================================================================

const path = require('path');
const db = require('../config/database');
const { backup } = require('../scripts/backup');
const logger = require('../utils/logger').child({ service: 'drDrillService' });

// Minimum acceptable backup size in bytes. A floor, not the real integrity
// signal (that's the structural check below): FireISP's own schema gzips to
// ~200 KB+, so 64 KB never false-positives on a legitimate install — the old
// hardcoded 1 MB flagged small orgs whose COMPLETE dump was a few hundred KB.
const MIN_BACKUP_BYTES = parseInt(process.env.DR_DRILL_MIN_BACKUP_BYTES || '65536', 10);

/**
 * Stream-validate the gzipped dump's structure without loading it into
 * memory: it must decompress cleanly, contain at least one CREATE TABLE, and
 * end with mysqldump's "-- Dump completed" trailer (both Oracle mysqldump and
 * mariadb-dump write it) — a truncated or empty dump fails regardless of its
 * byte size, and a complete small dump passes.
 *
 * @returns {Promise<{has_create_table:boolean, has_completed_trailer:boolean}>}
 */
function validateDumpStructure(backupFile) {
  const fs = require('fs');
  const zlib = require('zlib');
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    let sawCreateTable = false;
    let carry = '';
    let tail = '';
    gunzip.on('data', (chunk) => {
      const s = carry + chunk.toString('utf8');
      if (!sawCreateTable && s.includes('CREATE TABLE')) sawCreateTable = true;
      // Keep a small overlap so markers split across chunk boundaries still match.
      carry = s.slice(-32);
      tail = (tail + s).slice(-4096);
    });
    gunzip.on('end', () => resolve({
      has_create_table: sawCreateTable,
      has_completed_trailer: /-- Dump completed/.test(tail),
    }));
    gunzip.on('error', (err) => reject(new Error(`Backup is not a valid gzip stream: ${err.message}`, { cause: err })));
    fs.createReadStream(backupFile).on('error', reject).pipe(gunzip);
  });
}

/**
 * Run the automated DR drill.
 *
 * Returns a summary object suitable for use by taskRunner, and writes one
 * row to dr_drill_logs.
 *
 * @returns {Promise<{status:'pass'|'fail'|'error', checks:object, duration_ms:number}>}
 */
async function runDrill() {
  const startMs = Date.now();
  let backupFile = null;
  let backupSizeBytes = null;
  const checks = {};

  try {
    // ------------------------------------------------------------------
    // Phase 1 — Backup + size check
    // ------------------------------------------------------------------
    logger.info('DR drill Phase 1: taking backup');
    let backupResult;
    try {
      backupResult = await backup();
      backupFile = backupResult.filepath;
    } catch (backupErr) {
      throw new Error(`Backup failed: ${backupErr.message}`, { cause: backupErr });
    }

    const fs = require('fs');
    const stats = fs.statSync(backupFile);
    backupSizeBytes = stats.size;
    checks.backup_size_ok = backupSizeBytes >= MIN_BACKUP_BYTES;
    if (!checks.backup_size_ok) {
      throw new Error(`Backup too small: ${backupSizeBytes} bytes (minimum ${MIN_BACKUP_BYTES}; override with DR_DRILL_MIN_BACKUP_BYTES)`);
    }

    // Structure beats size: a complete dump of a small org passes, a truncated
    // dump of a big org fails.
    let structure;
    try {
      structure = await validateDumpStructure(backupFile);
    } catch (structErr) {
      checks.backup_structure_ok = false;
      throw structErr;
    }
    checks.backup_structure_ok = structure.has_create_table && structure.has_completed_trailer;
    if (!checks.backup_structure_ok) {
      throw new Error(
        !structure.has_create_table
          ? 'Backup structure check failed: no CREATE TABLE statement found in the dump'
          : 'Backup structure check failed: missing "-- Dump completed" trailer (truncated dump?)',
      );
    }
    logger.info({ backupFile: path.basename(backupFile), backupSizeBytes }, 'DR drill Phase 1 passed');

    // ------------------------------------------------------------------
    // Phase 4a — Core table row counts (all must be ≥ 1)
    // ------------------------------------------------------------------
    logger.info('DR drill Phase 4a: row counts');
    const tables = [
      'organizations', 'users', 'clients', 'contracts',
      'invoices', 'payments', 'tickets', 'devices', 'schema_migrations',
    ];
    const rowCounts = {};
    for (const tbl of tables) {
      const [[{ cnt }]] = await db.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
      rowCounts[tbl] = cnt;
    }
    checks.row_counts = rowCounts;
    // schema_migrations must equal at least 1 (should be 164 at this point)
    checks.schema_migrations_present = rowCounts.schema_migrations >= 1;

    // ------------------------------------------------------------------
    // Phase 4b — Referential-integrity (all must be 0)
    // ------------------------------------------------------------------
    logger.info('DR drill Phase 4b: FK orphan checks');
    const [orphanedContracts] = await db.query(
      `SELECT COUNT(*) AS n FROM contracts c
       LEFT JOIN clients cl ON cl.id = c.client_id WHERE cl.id IS NULL`,
    );
    const [orphanedInvoices] = await db.query(
      `SELECT COUNT(*) AS n FROM invoices i
       LEFT JOIN clients cl ON cl.id = i.client_id WHERE cl.id IS NULL`,
    );
    const [orphanedPayments] = await db.query(
      `SELECT COUNT(*) AS n FROM payments p
       LEFT JOIN clients cl ON cl.id = p.client_id WHERE cl.id IS NULL`,
    );
    const [orphanedAllocations] = await db.query(
      `SELECT COUNT(*) AS n FROM payment_allocations pa
       LEFT JOIN payments p ON p.id = pa.payment_id WHERE p.id IS NULL`,
    );
    // radius.contract_id and users.organization_id are NULLable by design
    // (unlinked subscriber rows / single-tenant deployments) — a NULL FK is
    // not an orphan, so only rows that NAME a missing parent count.
    const [orphanedRadius] = await db.query(
      `SELECT COUNT(*) AS n FROM radius r
       LEFT JOIN contracts c ON c.id = r.contract_id
       WHERE r.contract_id IS NOT NULL AND c.id IS NULL`,
    );
    const [orphanedUsers] = await db.query(
      `SELECT COUNT(*) AS n FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.organization_id IS NOT NULL AND o.id IS NULL`,
    );

    checks.fk_orphans = {
      orphaned_contracts:   orphanedContracts[0].n,
      orphaned_invoices:    orphanedInvoices[0].n,
      orphaned_payments:    orphanedPayments[0].n,
      orphaned_allocations: orphanedAllocations[0].n,
      orphaned_radius:      orphanedRadius[0].n,
      orphaned_users:       orphanedUsers[0].n,
    };
    checks.fk_orphans_ok = Object.values(checks.fk_orphans).every(n => n === 0);

    // ------------------------------------------------------------------
    // Phase 4c — Financial consistency (all must be 0)
    // ------------------------------------------------------------------
    logger.info('DR drill Phase 4c: financial consistency');
    // Compare stored subtotal against SUM(items.amount) — `amount` is what
    // every writer folds into invoices.subtotal (generate, one-off, add-item
    // delta), and POST /invoices/:id/items enforces amount ≈ quantity ×
    // unit_price at the API. The GENERATED `total` column (round2(q×p) per
    // line) drifts from `amount` by sub-cent rounding on fractional-quantity
    // lines (e.g. data-overage GB), so comparing against it would flag
    // healthy invoices. Manually-created invoices (POST /invoices) with
    // later-added lines keep their base amount outside any line — those are
    // genuinely unreconcilable from lines and SHOULD flag.
    const [inconsistentInvoices] = await db.query(
      `SELECT COUNT(*) AS n
       FROM invoices i
       JOIN (
         SELECT invoice_id, SUM(amount) AS lines_subtotal
         FROM invoice_items
         WHERE deleted_at IS NULL
         GROUP BY invoice_id
       ) ii ON ii.invoice_id = i.id
       WHERE i.deleted_at IS NULL
         AND ABS(i.subtotal - ii.lines_subtotal) > 0.01`,
    );
    // payment_allocations carries `amount` (portion applied to an invoice).
    const [overAllocated] = await db.query(
      `SELECT COUNT(*) AS n
       FROM payments p
       JOIN (
         SELECT payment_id, SUM(amount) AS total_applied
         FROM payment_allocations
         WHERE deleted_at IS NULL
         GROUP BY payment_id
       ) pa ON pa.payment_id = p.id
       WHERE p.deleted_at IS NULL
         AND pa.total_applied > p.amount + 0.01`,
    );

    checks.financial = {
      inconsistent_invoices:     inconsistentInvoices[0].n,
      over_allocated_payments:   overAllocated[0].n,
    };
    checks.financial_ok = Object.values(checks.financial).every(n => n === 0);

    // ------------------------------------------------------------------
    // Determine overall status
    // ------------------------------------------------------------------
    const allPassed = checks.backup_size_ok
      && checks.schema_migrations_present
      && checks.fk_orphans_ok
      && checks.financial_ok;

    const status = allPassed ? 'pass' : 'fail';
    const durationMs = Date.now() - startMs;

    const errorMessage = allPassed ? null : buildFailureSummary(checks);

    await writeDrillLog({
      status,
      backupFile: backupFile ? path.relative(process.cwd(), backupFile) : null,
      backupSizeBytes,
      checks,
      errorMessage,
      durationMs,
    });

    logger.info({ status, durationMs }, 'DR drill complete');
    return { status, checks, duration_ms: durationMs };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    logger.error({ err }, 'DR drill error');

    await writeDrillLog({
      status: 'error',
      backupFile: backupFile ? path.relative(process.cwd(), backupFile) : null,
      backupSizeBytes,
      checks,
      errorMessage: err.message,
      durationMs,
    }).catch(() => {});

    throw err;
  }
}

/**
 * Build a human-readable failure summary from checks.
 */
function buildFailureSummary(checks) {
  const failures = [];
  if (checks.backup_size_ok === false) failures.push('Backup file too small');
  if (checks.backup_structure_ok === false) failures.push('Backup structure check failed (empty or truncated dump)');
  if (checks.schema_migrations_present === false) failures.push('schema_migrations table is empty');
  if (checks.fk_orphans_ok === false) {
    const bad = Object.entries(checks.fk_orphans || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ');
    failures.push(`FK orphans detected: ${bad}`);
  }
  if (checks.financial_ok === false) {
    const bad = Object.entries(checks.financial || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ');
    failures.push(`Financial inconsistencies: ${bad}`);
  }
  return failures.join('; ');
}

/**
 * Write a row to dr_drill_logs.
 */
async function writeDrillLog({ status, backupFile, backupSizeBytes, checks, errorMessage, durationMs }) {
  await db.query(
    `INSERT INTO dr_drill_logs
       (status, backup_file, backup_size_bytes, checks, error_message, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      status,
      backupFile || null,
      backupSizeBytes || null,
      checks && Object.keys(checks).length > 0 ? JSON.stringify(checks) : null,
      errorMessage || null,
      durationMs,
    ],
  );
}

/**
 * Return the current drill status for the /dr-drill/status endpoint.
 *
 * @returns {Promise<{last_run_at:Date|null, status:string|null, days_since_drill:number|null, overdue:boolean, last_error:string|null}>}
 */
async function getDrillStatus() {
  const [rows] = await db.query(
    'SELECT * FROM dr_drill_logs ORDER BY run_at DESC LIMIT 1',
  );

  if (!rows.length) {
    return {
      last_run_at: null,
      status: null,
      days_since_drill: null,
      overdue: true,
      last_error: null,
    };
  }

  const latest = rows[0];
  const daysSince = Math.floor(
    (Date.now() - new Date(latest.run_at).getTime()) / (1000 * 60 * 60 * 24),
  );

  return {
    last_run_at: latest.run_at,
    status: latest.status,
    days_since_drill: daysSince,
    overdue: daysSince > 90 || latest.status !== 'pass',
    last_error: latest.error_message || null,
  };
}

module.exports = { runDrill, getDrillStatus };
