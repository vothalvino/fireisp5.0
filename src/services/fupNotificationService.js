'use strict';

// =============================================================================
// FireISP 5.0 — FUP Usage Notification Service (§10.3)
// =============================================================================
// Checks subscriber data usage against their plan caps and sends de-duplicated
// notifications at the 80%, 90%, and 100% thresholds each billing month.
// =============================================================================

const db = require('../config/database');

/**
 * Check all active contracts in an org for 80/90/100% threshold crossings
 * and record a notification row (dedup via UNIQUE KEY).
 *
 * @param {number} organizationId
 * @returns {Promise<{checked: number, notified: number}>}
 */
async function checkAndNotifyThresholds(organizationId) {
  const now = new Date();
  const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endStr = endOfMonth.toISOString().slice(0, 10);

  const [contracts] = await db.query(
    `SELECT c.id, c.organization_id, c.client_id,
            p.data_cap_gb, p.fup_threshold_gb
     FROM contracts c
     JOIN plans p ON c.plan_id = p.id
     WHERE c.status = 'active'
       AND (p.data_cap_gb IS NOT NULL OR p.fup_threshold_gb IS NOT NULL)
       AND c.organization_id = ?
       AND c.deleted_at IS NULL`,
    [organizationId],
  );

  let checked = 0;
  let notified = 0;

  for (const contract of contracts) {
    checked++;
    const capGb = parseFloat(contract.data_cap_gb) || parseFloat(contract.fup_threshold_gb) || 0;
    if (capGb <= 0) continue;

    const [[usage]] = await db.query(
      `SELECT COALESCE(SUM(bytes_in + bytes_out) / 1073741824.0, 0) AS used_gb
       FROM connection_logs
       WHERE contract_id = ?
         AND created_at >= ?
         AND created_at <= ?`,
      [contract.id, billingMonth, endStr + ' 23:59:59'],
    );

    const usedGb = parseFloat(usage.used_gb) || 0;
    const usagePct = (usedGb / capGb) * 100;

    for (const threshold of [80, 90, 100]) {
      if (usagePct < threshold) continue;

      // Check dedup: already notified for this threshold this month?
      const [[existing]] = await db.query(
        `SELECT id FROM fup_usage_notifications
         WHERE contract_id = ? AND billing_month = ? AND threshold_pct = ?`,
        [contract.id, billingMonth, threshold],
      );
      if (existing) continue;

      // Insert dedup record (ignore race duplicates via ER_DUP_ENTRY)
      try {
        await db.query(
          `INSERT INTO fup_usage_notifications
             (organization_id, contract_id, billing_month, threshold_pct, channel)
           VALUES (?, ?, ?, ?, 'email')`,
          [contract.organization_id, contract.id, billingMonth, threshold],
        );
        notified++;
        // Emit event for email/push/webhook hooks (best-effort)
        try {
          const eventBus = require('./eventBus');
          eventBus.emit('fup.threshold_reached', {
            organizationId: contract.organization_id,
            contractId: contract.id,
            clientId: contract.client_id,
            pct: threshold,
            used_gb: usedGb,
            cap_gb: capGb,
          });
        } catch (_e) {
          // eventBus is optional — swallow if not available
        }
      } catch (dupErr) {
        if (dupErr.code !== 'ER_DUP_ENTRY') throw dupErr;
      }
    }
  }

  return { checked, notified };
}

/**
 * List recent FUP usage notifications for an org, optionally filtered by
 * contract or billing month.
 *
 * @param {number} organizationId
 * @param {{contractId?: number, month?: string}} [filters]
 * @returns {Promise<Array>}
 */
async function listNotifications(organizationId, { contractId, month } = {}) {
  let where = 'fun.organization_id = ?';
  const params = [organizationId];
  if (contractId) {
    where += ' AND fun.contract_id = ?';
    params.push(contractId);
  }
  if (month) {
    where += ' AND fun.billing_month = ?';
    params.push(month);
  }
  const [rows] = await db.query(
    `SELECT fun.*
     FROM fup_usage_notifications fun
     WHERE ${where}
     ORDER BY fun.notified_at DESC
     LIMIT 200`,
    params,
  );
  return rows;
}

module.exports = { checkAndNotifyThresholds, listNotifications };
