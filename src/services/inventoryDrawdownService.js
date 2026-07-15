// =============================================================================
// FireISP 5.0 — Inventory Sale Drawdown Service (Inventory Phase 2, §14.2)
// =============================================================================
// Decrements stock for a sale (an invoice line item linked to an
// inventory_items row) and writes a matching `sell_to_client` ledger row.
// Runs entirely on the CALLER's transaction connection — it never opens or
// commits its own transaction, so it can be composed into either:
//   • POST /invoices/:id/items (src/routes/invoices.js)
//   • POST /quotes/:id/convert-to-invoice (src/routes/quotes.js)
// without risking a partial write if a later step in the caller's
// transaction fails.
//
// Policy v1 (PR brief, user-confirmed):
//   • Drawdown always targets the org's EXISTING inventory_stock row with the
//     GREATEST quantity for that item — deterministic, no warehouse picker
//     yet (a later enhancement).
//   • If the item has no stock row anywhere for the org, one is created (at
//     quantity 0) at the org's first warehouse before the decrement, mirroring
//     the item_id+warehouse_id upsert POST /inventory/transactions already
//     does for 'receive'/'adjustment' (src/routes/inventory.js).
//   • Negative stock is ALLOWED — this never throws for insufficient stock.
//     Migration 390 drops the migration-127 negative-stock guard trigger for
//     exactly this reason: invoicing a linked product must never fail because
//     of a stock-count drift.
//
// The `execute` parameter is a bound query FUNCTION — `conn.execute.bind(conn)`
// — not a conn/db OBJECT. Both current call sites already issue their other
// transactional writes via `conn.execute`, and this codebase's jest mocks for
// `conn` and `db` are NOT interchangeable even though the real mysql2 objects
// both expose `.query()`/`.execute()` (see agent-memory
// shared-sql-helper-bound-exec-pattern.md).
// =============================================================================

const { ValidationError } = require('../utils/errors');

/**
 * Find the org's existing inventory_stock row with the greatest quantity for
 * an item, or create a zero-quantity row at the org's first warehouse when
 * none exists yet. Shared by drawdownForSale (sell_to_client) and, since
 * Inventory Phase 3 (migration 391), inventorySerialService's install
 * (assign_to_job) and pickup-return (return) ledger writes — every caller
 * that needs to move inventory_stock.quantity for an org+item pair without a
 * warehouse picker resolves the target row the same deterministic way.
 * @param {(sql: string, params: unknown[]) => Promise<[unknown, unknown]>} execute
 * @param {{ orgId: number, itemId: number }} params
 * @returns {Promise<number>} inventory_stock.id
 */
async function resolveOrCreateStockRow(execute, { orgId, itemId }) {
  const [stockRows] = await execute(
    `SELECT s.id FROM inventory_stock s
     JOIN inventory_items i ON i.id = s.item_id
     WHERE s.item_id = ? AND s.deleted_at IS NULL AND (i.organization_id = ? OR i.organization_id IS NULL)
     ORDER BY s.quantity DESC, s.id ASC
     LIMIT 1`,
    [itemId, orgId],
  );

  const stockId = stockRows[0]?.id;
  if (stockId) return stockId;

  const [warehouseRows] = await execute(
    'SELECT id FROM warehouses WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL ORDER BY id ASC LIMIT 1',
    [orgId],
  );
  const warehouse = warehouseRows[0];
  if (!warehouse) {
    throw new ValidationError(
      'No warehouse is configured for this organization; cannot record stock for this item',
      [{ field: 'inventory_item_id', message: 'No warehouse available to hold stock' }],
    );
  }
  const [ins] = await execute(
    'INSERT INTO inventory_stock (item_id, warehouse_id, quantity) VALUES (?, ?, 0)',
    [itemId, warehouse.id],
  );
  return ins.insertId;
}

/**
 * @param {(sql: string, params: unknown[]) => Promise<[unknown, unknown]>} execute
 * @param {{
 *   orgId: number,
 *   itemId: number,
 *   quantity: number,
 *   unitPrice?: number|string|null,
 *   invoiceId: number,
 *   clientId?: number|null,
 *   performedBy?: number|null,
 *   reference?: string|null,
 * }} params
 * @returns {Promise<number>} the inventory_stock.id that was decremented
 */
async function drawdownForSale(execute, {
  orgId, itemId, quantity, unitPrice, invoiceId, clientId, performedBy, reference,
}) {
  const stockId = await resolveOrCreateStockRow(execute, { orgId, itemId });

  // Defensive integer floor: both call sites (POST /invoices/:id/items and
  // POST /quotes/:id/convert-to-invoice) already reject a fractional
  // quantity at line-item creation time when inventory_item_id is set, so
  // this should always already be a whole number. Rounding here anyway means
  // a future caller/bug can never silently move a fractional amount of
  // physical stock — inventory_stock.quantity and inventory_transactions.quantity
  // are both integer columns.
  const drawdownQty = Math.round(Number(quantity));

  // Negative stock is allowed — see module header. No floor/clamp on VALUE here.
  await execute('UPDATE inventory_stock SET quantity = quantity - ? WHERE id = ?', [drawdownQty, stockId]);

  // Mirrors POST /inventory/transactions' ledger INSERT column list exactly
  // (src/routes/inventory.js) — quantity is stored as the raw positive line
  // quantity (matching that endpoint's existing convention), not negated.
  await execute(
    `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, unit_price, job_id, client_id, invoice_id, performed_by, reference, notes)
     VALUES (?, 'sell_to_client', ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    [stockId, drawdownQty, unitPrice ?? null, clientId ?? null, invoiceId, performedBy ?? null, reference ?? null],
  );

  return stockId;
}

module.exports = { drawdownForSale, resolveOrCreateStockRow };
