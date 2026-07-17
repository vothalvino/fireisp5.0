'use strict';

// =============================================================================
// FireISP 5.0 — Rollover Balance Service (§10.3)
// =============================================================================
// Manages monthly data rollover balances for subscribers with data caps.
// Unused data (up to 25% of cap) is carried forward to the next billing month.
// =============================================================================

const db = require('../config/database');

/**
 * Accrue rollover balances for active contracts with unused data caps.
 * Idempotent — safe to run multiple times per month (ON DUPLICATE KEY UPDATE).
 *
 * @param {number|null} organizationId  NULL to process all orgs
 * @returns {Promise<{processed: number, rolled_over_contracts: number}>}
 */
async function accrueRollover(organizationId) {
  const now = new Date();
  // The balance row is keyed to the month it is AVAILABLE IN (the current
  // month); the unused data it carries forward is measured over the PREVIOUS
  // month. The scheduled task fires at 00:00 on the 1st — measuring the
  // just-started month here would read ~0 usage and hand every capped
  // contract the maximum 25% rollover.
  const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const prevStart = fmt(prevStartDate);
  const prevEnd = fmt(prevEndDate);

  const [contracts] = await db.query(
    `SELECT c.id, c.organization_id, p.data_cap_gb
     FROM contracts c
     JOIN plans p ON c.plan_id = p.id
     WHERE c.status = 'active'
       AND p.data_cap_gb IS NOT NULL
       AND p.data_cap_gb > 0
       AND (c.organization_id = ? OR ? IS NULL)
       AND c.deleted_at IS NULL`,
    [organizationId, organizationId],
  );

  let processed = 0;
  let rolled_over_contracts = 0;

  for (const contract of contracts) {
    const [[usage]] = await db.query(
      `SELECT COALESCE(SUM(bytes_in + bytes_out) / 1073741824.0, 0) AS used_gb
       FROM connection_logs
       WHERE contract_id = ?
         AND created_at >= ?
         AND created_at <= ?`,
      [contract.id, prevStart, prevEnd + ' 23:59:59'],
    );

    const usedGb = parseFloat(usage.used_gb) || 0;
    const capGb = parseFloat(contract.data_cap_gb);

    if (usedGb < capGb) {
      const rolloverGb = Math.min(capGb - usedGb, capGb * 0.25);

      await db.query(
        `INSERT INTO data_rollover_balances
           (organization_id, contract_id, billing_month, rollover_gb, consumed_rollover_gb)
         VALUES (?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE
           rollover_gb = VALUES(rollover_gb),
           updated_at  = NOW()`,
        [contract.organization_id, contract.id, billingMonth, rolloverGb.toFixed(3)],
      );
      rolled_over_contracts++;
    }
    processed++;
  }

  return { processed, rolled_over_contracts };
}

/**
 * Get rollover balance summary for a contract.
 *
 * @param {number} contractId
 * @returns {Promise<object>}
 */
async function getRolloverBalance(contractId) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const [rows] = await db.query(
    `SELECT billing_month,
            rollover_gb,
            consumed_rollover_gb,
            (rollover_gb - consumed_rollover_gb) AS available_gb
     FROM data_rollover_balances
     WHERE contract_id = ?
     ORDER BY billing_month DESC
     LIMIT 3`,
    [contractId],
  );

  const current = rows.find(r => {
    const monthStr = r.billing_month instanceof Date
      ? r.billing_month.toISOString().slice(0, 10)
      : String(r.billing_month).slice(0, 10);
    return monthStr === currentMonth;
  });

  return {
    current_month: current || null,
    history: rows,
    total_available_gb: rows.reduce((sum, r) => sum + parseFloat(r.available_gb || 0), 0),
  };
}

/**
 * Consume rollover GB for a contract (e.g., when data pack headroom is applied).
 *
 * @param {number} contractId
 * @param {number} gb  Amount to consume
 * @returns {Promise<{consumed: number, remaining: number}>}
 */
async function consumeRollover(contractId, gb) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const [[row]] = await db.query(
    `SELECT id, rollover_gb, consumed_rollover_gb
     FROM data_rollover_balances
     WHERE contract_id = ? AND billing_month = ?`,
    [contractId, currentMonth],
  );

  if (!row) return { consumed: 0, remaining: 0 };

  const available = parseFloat(row.rollover_gb) - parseFloat(row.consumed_rollover_gb);
  const toConsume = Math.min(gb, available);

  await db.query(
    `UPDATE data_rollover_balances
     SET consumed_rollover_gb = consumed_rollover_gb + ?
     WHERE id = ?`,
    [toConsume.toFixed(3), row.id],
  );

  return { consumed: toConsume, remaining: available - toConsume };
}

module.exports = { accrueRollover, getRolloverBalance, consumeRollover };
