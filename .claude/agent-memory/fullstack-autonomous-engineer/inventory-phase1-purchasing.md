---
name: inventory-phase1-purchasing
description: Inventory Phase 1 (§14.2) — Vendors/PO frontend built, PO receive + generic transactions endpoint hardened; product/invoice linkage and stock drawdown are explicitly Phase 2/3
metadata:
  type: project
---

Built on branch `feat/inventory-phase1-purchasing`, commit 62f5f3e. Backend
CRUD for vendors/purchase_orders/inventory (routes, models, permissions) had
existed since an earlier §14.2 pass — the actual gap was 100% frontend (no
Vendors or Purchase Order UI existed anywhere) plus two real backend bugs.

**No migration was needed** — schema.sql already had every column this PR
touched (`purchase_orders.total`, `assets.warranty_expires_at`,
`inventory_transactions.reference`/`performed_by`, etc.). Don't assume a
frontend-heavy PR always needs a migration; check schema.sql first.

## What shipped
- `VendorList.tsx` (new, `/vendors`), `PurchaseOrderList.tsx` +
  `PurchaseOrderDetail.tsx` (new, `/purchase-orders` + `/purchase-orders/:id`)
  — full create/receive flow. PO create is header-only (vendor/warehouse/
  po_number/dates); line items + Receive live on the detail page, mirroring
  QuoteList→QuoteDetail's pattern (auto-generated PO number client-side since,
  unlike invoices/quotes, POs have no server-side numbering sequence — brief
  didn't ask for one, out of scope to add).
- `POST /purchase-orders/:id/receive` rewritten: wrapped in a
  `db.getConnection()` transaction, writes an `inventory_transactions` ledger
  row (type 'receive', reference=po_number) per line that gains quantity —
  previously this endpoint bypassed the ledger entirely, the #1 flagged gap.
  Added optional partial receive via `items:[{id, quantity_received}]`
  (cumulative target value, not a delta; omitted lines stay unchanged; a value
  below current is clamped up, i.e. no reversing a receipt). PO status now
  resolves to `partial`/`received` correctly. Side effect: lines with
  `inventory_item_id = NULL` (freight/misc) now get `quantity_received`
  updated too (previously silently skipped even that, a separate pre-existing
  bug fixed as a natural consequence of the rewrite).
- `POST /inventory/transactions`: `stock_id` is no longer schema-required.
  For `transaction_type` `receive`/`adjustment`, passing `item_id` +
  `warehouse_id` instead creates (or finds) the `inventory_stock` row inline
  — this is what makes "add first-time stock for a brand-new item" possible
  without a full PO. Other types still require an existing `stock_id` (can't
  sell/assign/transfer from nothing). Wrapped in a transaction; added
  org-scoping on `stock_id`/`item_id`/`warehouse_id` (none existed before);
  also fixed a silent-data-loss bug found while rewriting this exact INSERT —
  `reference` and `performed_by` were validated/accepted but never actually
  written to the row.
- `InventoryList.tsx`'s "+Txn" modal: selecting a warehouse with no existing
  stock row used to leave `stockId` empty and block submit with "Please
  select a warehouse" even though one WAS selected. Now sends
  `item_id`+`warehouse_id` when `stockId` resolves empty, gated to
  receive/adjustment (mirrors the backend's own type gate).
- `InventoryManagement.tsx` crash fixes: `PurchaseOrder.total_amount` → real
  column is `total` (was `undefined.toLocaleString()` TypeError on any PO
  row); `Asset.warranty_expires` → real column is `warranty_expires_at` (was
  silently always "—", not a crash).

## Explicitly deferred (Phase 2/3 — do not build without a new brief)
- No `plan_addons.inventory_item_id` link; inventory items still can't appear
  on an invoice/quote "Product" line.
- No stock drawdown on sale/install (`sell_to_client`/`assign_to_job` transaction
  types exist in the enum but nothing triggers them automatically).
- `GET /inventory/items` still doesn't join `inventory_stock` for a
  `quantity_on_hand` column (brief said "if feasible" — skipped: would require
  overriding crudController's generic list handler with custom
  SQL+pagination, non-trivial for a "nice to have").
- `inventory.transfer` permission is still dead (no destination_stock_id-based
  transfer endpoint).
- Billing role still has zero inventory/vendors/purchase_orders permissions —
  explicitly flagged, not fixed (brief: "Do NOT change the permission model").

## Pre-existing gaps noticed but NOT fixed (flagged per CLAUDE.md, out of scope)
- **OpenAPI spec drift on inventory items**: `src/utils/openapi.js` documents
  `/inventory` + `/inventory/{id}` via `crudPaths('inventory', ...)`, but the
  REAL routes are `/inventory/items`, `/inventory/items/{id}`,
  `/inventory/items/{id}/stock`, `/inventory/transactions` — completely
  different paths. `pnpm spec:check` never catches this (compares generator
  output to committed JSON, not real routes — see [[openapi-pattern]]). Every
  frontend call to `/inventory/items` needs `'/inventory/items' as never`
  because TS doesn't even know the path exists. Not fixed here — real fix
  means adding correct inline path entries and removing the wrong
  `crudPaths('inventory', ...)` call, non-trivial scope creep for this PR.
- `inventory.js`'s adjustment-type sign bug: `POST /transactions` computes
  `quantityChange = isInbound ? Math.abs(quantity) : -Math.abs(quantity)`, and
  `adjustment` is NOT in the inbound list — so a positive adjustment quantity
  (meant to increase stock) actually DECREASES it, same as a negative one.
  Pre-existing, not touched (out of scope; `receive` — the default/recommended
  type for first-time stock — is unaffected since it IS inbound).

## Testing patterns that worked
- `tests/purchaseOrders.test.js`'s pre-existing receive test needed
  `db.getConnection.mockResolvedValue(conn)` added (with `beginTransaction/
  query/commit/rollback/release`) since the route now opens a transaction —
  see [[testing-conventions]]'s serviceOrders.js transaction-mock pattern,
  reused verbatim for both `purchaseOrders.test.js` and the new
  `inventoryTransactions.test.js`.
- Frontend: `getByText(/Receive/)` regex collides with a "Received" table
  header cell — use `getByRole('button', {name: /Receive/})` to scope. Same
  class of bug as the existing "modal header ✕ + footer button share a name"
  memory note — always scope ambiguous action-word queries to `role`.
