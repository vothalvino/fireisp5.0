// =============================================================================
// FireISP 5.0 — Payment Allocation Service
// =============================================================================
// Shared logic between POST /payments/:id/allocate (single invoice, kept for
// API compatibility) and POST /payments/:id/allocate-auto (FIFO oldest→newest,
// multi-invoice waterfall). Both routes call the SAME "mark a fully-covered
// invoice paid + reconnect a suspended contract" logic and the SAME "client's
// payable invoices with a live balance_due" query, so the two endpoints
// cannot drift out of sync with each other (see PR brief "payment waterfall").
//
// invoices.status has NO 'partial'/'partially_paid' value in the ENUM
// (database/schema.sql) — a partially-allocated invoice is intentionally left
// in its current status (issued/sent/overdue); only a FULLY covered invoice
// flips to 'paid'. Do not invent an enum value here.
// =============================================================================

const db = require('../config/database');
const suspensionService = require('./suspensionService');

// Invoices in these statuses can receive a payment allocation. Mirrors the
// frontend's NON_PAYABLE_STATUSES set (frontend/src/pages/payments/
// PaymentActions.tsx: void/cancelled/paid/draft excluded) — keep both in sync.
const PAYABLE_STATUSES = ['issued', 'sent', 'overdue'];

/**
 * Recompute an invoice's live allocated total and flip it to 'paid' (+paid_at)
 * once fully covered. Takes a bound query FUNCTION — e.g. `conn.execute.bind(conn)`
 * inside an open allocate-auto transaction, or `db.query.bind(db)` for the
 * standalone single-allocate route — NOT a conn/db object (see
 * suspensionService.logSuspensionEvent's header comment for why: mocked test
 * doubles for conn vs db assert on different methods).
 *
 * SQL/param shape (`UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?`,
 * `['paid', invoice.id]`) intentionally matches what POST /:id/allocate has
 * always issued — existing tests assert on it.
 *
 * @param {Function} exec - bound query function: (sql, params) => Promise
 * @param {{id:number, total:string|number}} invoice
 * @returns {Promise<boolean>} true if this call just marked it paid
 */
async function finalizeIfFullyPaid(exec, invoice) {
  const [allocRows] = await exec(
    'SELECT SUM(amount) AS total_allocated FROM payment_allocations WHERE invoice_id = ? AND deleted_at IS NULL',
    [invoice.id],
  );
  const totalAllocated = parseFloat(allocRows[0].total_allocated || 0);
  if (totalAllocated < parseFloat(invoice.total)) return false;
  await exec(
    'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
    ['paid', invoice.id],
  );
  return true;
}

/**
 * If the invoice's contract is currently suspended, reconnect it. Always call
 * this AFTER the allocation transaction commits — reconnectContract opens and
 * manages its OWN connection/transaction (RADIUS CoA, suspension_logs) and
 * cannot join an outer one. Matches the pre-existing single-allocate route's
 * behaviour and billingService.refreshInvoicePaidStatus's "outside the
 * transaction — reads committed state" convention (see reallocate route).
 *
 * @param {{id:number, contract_id:number|null}} invoice
 * @param {number} userId
 * @returns {Promise<boolean>} true if a reconnect was actually performed
 */
async function reconnectIfSuspended(invoice, userId) {
  if (!invoice.contract_id) return false;
  const [contractRows] = await db.query(
    'SELECT * FROM contracts WHERE id = ? AND status = ? AND deleted_at IS NULL',
    [invoice.contract_id, 'suspended'],
  );
  if (!contractRows[0]) return false;
  await suspensionService.reconnectContract(invoice.contract_id, userId, invoice.id);
  return true;
}

/**
 * A client's invoices with a computed, live balance_due, oldest issue_date
 * first (ties broken by id) — the FIFO waterfall order. Shared by
 * GET /clients/:id/open-invoices (frontend checklist display) and
 * POST /payments/:id/allocate-auto (both the "no invoice_ids given → all
 * payable invoices" branch and the "invoice_ids given → org+client-verified
 * subset" branch), so the order the checklist shows always matches the order
 * money is actually applied in, and a caller-supplied invoice_id that isn't
 * in this result is provably missing / wrong org / wrong client / not payable.
 *
 * @param {Function} exec - bound query function. Pass `conn.execute.bind(conn)`
 *   from inside an allocate-auto transaction with `forUpdate: true` so the
 *   invoice rows are locked for the duration of the allocation; pass
 *   `db.query.bind(db)` for a plain read (the GET display endpoint).
 * @param {number} orgId
 * @param {number} clientId
 * @param {number[]|null} [invoiceIds] - restrict to these ids; null/undefined = all payable invoices
 * @param {boolean} [forUpdate] - append FOR UPDATE (only valid inside a transaction)
 */
async function getInvoicesWithBalance(exec, orgId, clientId, invoiceIds, forUpdate) {
  const statusPlaceholders = PAYABLE_STATUSES.map(() => '?').join(', ');
  const idFilter = invoiceIds && invoiceIds.length
    ? `AND i.id IN (${invoiceIds.map(() => '?').join(', ')})`
    : '';
  const [rows] = await exec(
    `SELECT i.*,
            (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                                   WHERE pa.invoice_id = i.id AND pa.deleted_at IS NULL), 0)) AS balance_due
       FROM invoices i
      WHERE i.client_id = ? AND i.organization_id = ? AND i.deleted_at IS NULL
        AND i.status IN (${statusPlaceholders}) ${idFilter}
      ORDER BY i.issue_date ASC, i.id ASC
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [clientId, orgId, ...PAYABLE_STATUSES, ...(invoiceIds || [])],
  );
  return rows;
}

module.exports = {
  PAYABLE_STATUSES,
  finalizeIfFullyPaid,
  reconnectIfSuspended,
  getInvoicesWithBalance,
};
