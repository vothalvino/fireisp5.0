// =============================================================================
// FireISP 5.0 — Reseller Service (§19)
// =============================================================================
// Business logic for the multi-level reseller hierarchy:
//   - getResellerSubtree  — resolve all reseller IDs in a subtree (for scoping)
//   - getResellerClientIds — all client IDs belonging to a reseller subtree
//   - getResellerDashboard — §19.3 aggregate stats for a reseller
//   - recordCommission     — auto-create commission record when invoice is paid
//
// Reseller scoping is a product-feature ownership filter (like organization_id).
// It is NOT a hard multi-tenant security isolation layer.
// =============================================================================

const db = require('../config/database');
const Organization = require('../models/Organization');

/**
 * Returns the flat list of reseller IDs that are in the subtree rooted at
 * resellerIds (inclusive of the root ids). Depth is limited to 2 (Master + Sub).
 *
 * @param {number[]} rootIds - array of reseller IDs to start from
 * @param {number}   orgId   - organization scope
 * @returns {Promise<number[]>}
 */
async function getResellerSubtree(rootIds, orgId) {
  if (!rootIds || rootIds.length === 0) return [];

  const [children] = await db.query(
    `SELECT id FROM resellers
     WHERE organization_id = ? AND parent_id IN (?) AND deleted_at IS NULL`,
    [orgId, rootIds],
  );

  const childIds = children.map((r) => r.id);
  return [...rootIds, ...childIds];
}

/**
 * Returns all client IDs belonging to the reseller subtree.
 *
 * @param {number[]} resellerIds - flat subtree of reseller IDs
 * @param {number}   orgId
 * @returns {Promise<number[]>}
 */
async function getResellerClientIds(resellerIds, orgId) {
  if (!resellerIds || resellerIds.length === 0) return [];

  const [rows] = await db.query(
    `SELECT id FROM clients
     WHERE organization_id = ? AND reseller_id IN (?) AND deleted_at IS NULL`,
    [orgId, resellerIds],
  );
  return rows.map((r) => r.id);
}

/**
 * Dashboard aggregates for a reseller (§19.3):
 *   - subscriber_count : active clients
 *   - total_revenue    : sum of paid invoices this month
 *   - open_tickets     : open tickets on their clients
 *   - pending_commissions : sum of pending commission amounts
 *
 * @param {number} resellerId
 * @param {number} orgId
 * @returns {Promise<object>}
 */
async function getResellerDashboard(resellerId, orgId) {
  // Resolve subtree
  const subtree = await getResellerSubtree([resellerId], orgId);
  const clientIds = await getResellerClientIds(subtree, orgId);

  const result = {
    reseller_id: resellerId,
    subscriber_count: 0,
    total_revenue: 0,
    open_tickets: 0,
    pending_commission: 0,
  };

  if (clientIds.length === 0) return result;

  const [[subRow]] = await db.query(
    'SELECT COUNT(*) AS cnt FROM clients WHERE id IN (?) AND status = ? AND deleted_at IS NULL',
    [clientIds, 'active'],
  );
  result.subscriber_count = subRow.cnt;

  const [[revRow]] = await db.query(
    `SELECT COALESCE(SUM(total), 0) AS rev
     FROM invoices
     WHERE client_id IN (?)
       AND status = 'paid'
       AND YEAR(issue_date) = YEAR(CURDATE())
       AND MONTH(issue_date) = MONTH(CURDATE())`,
    [clientIds],
  );
  result.total_revenue = parseFloat(revRow.rev) || 0;

  const [[tickRow]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM tickets
     WHERE client_id IN (?) AND status NOT IN ('resolved','closed') AND deleted_at IS NULL`,
    [clientIds],
  );
  result.open_tickets = tickRow.cnt;

  const [[commRow]] = await db.query(
    `SELECT COALESCE(SUM(commission_amount), 0) AS total
     FROM reseller_commissions
     WHERE reseller_id = ? AND status = 'pending'`,
    [resellerId],
  );
  result.pending_commission = parseFloat(commRow.total) || 0;

  return result;
}

/**
 * Record a commission entry when an invoice is paid for a reseller's client.
 * Idempotent — uses INSERT IGNORE via unique key (reseller_id, invoice_id).
 *
 * @param {number} invoiceId
 * @param {number} orgId
 * @returns {Promise<void>}
 */
async function recordCommission(invoiceId, orgId) {
  const [[inv]] = await db.query(
    'SELECT id, client_id, total, currency FROM invoices WHERE id = ? AND organization_id = ?',
    [invoiceId, orgId],
  );
  if (!inv) return;

  const [[client]] = await db.query(
    'SELECT reseller_id FROM clients WHERE id = ? AND deleted_at IS NULL',
    [inv.client_id],
  );
  if (!client || !client.reseller_id) return;

  const [[reseller]] = await db.query(
    'SELECT id, commission_rate FROM resellers WHERE id = ? AND deleted_at IS NULL',
    [client.reseller_id],
  );
  if (!reseller) return;

  const commissionAmount = ((parseFloat(inv.total) * reseller.commission_rate) / 100).toFixed(2);

  // invoices.currency is NOT NULL so the fallback should never fire — but
  // when it does, use the org's currency, never a hardcoded 'USD'.
  const currency = inv.currency || await Organization.getCurrency(orgId);

  await db.query(
    `INSERT IGNORE INTO reseller_commissions
       (reseller_id, invoice_id, client_id, commission_rate, invoice_total, commission_amount, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reseller.id, invoiceId, inv.client_id, reseller.commission_rate,
      inv.total, commissionAmount, currency],
  );
}

module.exports = {
  getResellerSubtree,
  getResellerClientIds,
  getResellerDashboard,
  recordCommission,
};
