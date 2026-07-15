---
name: inventory-phase2-product-linkage
description: Inventory Phase 2 (§14.2 cont'd) — plan_addons/invoice_items/quote_items.inventory_item_id link, sale drawdown on invoice items, movements ledger UI; migration 390 also drops the migration-127 negative-stock guard trigger
metadata:
  type: project
---

Built on branch `feat/inventory-phase2-products`, commit b693989 (based on
main @ 923331b, which already included Phase 1 / PR #410). Not pushed/PR'd
per brief — local commit only.

## The one non-obvious discovery: migration 127's trigger blocked the brief's own requirement

`trg_inventory_stock_negative_bu` (added migration 127) raises SQLSTATE
'45000' on any UPDATE that would set `inventory_stock.quantity < 0`. The
brief's user-confirmed policy is "negative stock is allowed — never block an
invoice over a stock-count drift." Those two are directly incompatible: any
drawdown that would go negative would 500 the whole invoice-item transaction.
Migration 390 `DROP TRIGGER`s it (naturally idempotent, no guard needed) and
removes the CREATE TRIGGER block from `database/schema.sql`; the rollback
recreates it. This was found by reading `database/schema.sql` before writing
the drawdown logic — always check for triggers on a table before assuming a
plain `UPDATE ... SET quantity = quantity - ?` will behave as speced.

## What shipped

- **Migration 390**: `plan_addons.inventory_item_id`, `invoice_items.inventory_item_id`,
  `quote_items.inventory_item_id` — all nullable FK → `inventory_items(id)`
  `ON DELETE SET NULL`, INFORMATION_SCHEMA-guarded ALTERs (migration 371/374
  pattern) + the trigger drop above. No new tables (328 unchanged), no new
  permissions (reuses `inventory.view`/`invoices.*`/`quotes.*`/`plans.*`).
- `src/services/inventoryDrawdownService.js` (new) — `drawdownForSale(execute, {...})`.
  Takes a **bound query function**, not a conn/db object (see
  [[shared-sql-helper-bound-exec-pattern]] — both of this file's real call
  sites already used `conn.execute`, so that's the only signature needed).
  Policy: SELECT the org's stock row with `ORDER BY s.quantity DESC, s.id ASC
  LIMIT 1`; if none exists, SELECT the org's first warehouse
  (`ORDER BY id ASC LIMIT 1`) and INSERT a zero-quantity stock row there
  (422 if the org has literally no warehouse at all — a setup gap, not a
  stock-count drift, so blocking here is correct); `UPDATE ... SET quantity =
  quantity - ?` with no floor/guard clause; INSERT into
  `inventory_transactions` mirroring Phase 1's exact column list (`stock_id,
  transaction_type, quantity, unit_price, job_id, client_id, invoice_id,
  performed_by, reference, notes`) — `quantity` is stored as the raw positive
  line quantity, matching Phase 1's existing (if comment-contradicting)
  convention, not negated for outbound.
- `src/routes/invoices.js` `POST /:id/items`: branches ONLY when
  `inventory_item_id` is present — the free-text/non-inventory path is
  byte-for-byte unchanged (still `Invoice.addItem(data)` via the pool, no
  transaction), so the existing `routesCoverage.test.js` coverage for that
  path needed zero changes. The inventory-linked branch opens
  `db.getConnection()`, org-verifies the invoice AND the inventory item
  (422/404), calls `Invoice.addItem(data, conn.execute.bind(conn))` (model
  method now takes an optional bound-exec 2nd arg, default `db.query.bind(db)`),
  then `drawdownForSale`, then commits. Org-verifying the invoice here closes
  a **pre-existing gap** (this route never checked `organization_id` before)
  as an incidental side effect of needing the invoice's `client_id`/
  `invoice_number` for the ledger row — not a deliberate separate fix.
- `src/routes/quotes.js` `POST /:id/items`: quotes **never** draw down (user-
  confirmed), so this stays non-transactional — only adds an org-ownership
  check on `inventory_item_id` (422) before `Quote.addItem`.
  `POST /:id/convert-to-invoice`: the existing raw-SQL copy loop
  (`quote_items` → `invoice_items`) now also copies `inventory_item_id` and,
  when set, calls `drawdownForSale` inline on the SAME `conn` used for the
  rest of the conversion transaction — this route never calls
  `POST /invoices/:id/items` internally, so a line is drawn down exactly
  once, with no separate double-draw guard needed.
- `GET /plans/addons/catalog` (`Plan.getAddons`): single query, `LEFT JOIN
  inventory_stock ... GROUP BY pa.id`, `COALESCE(SUM(s.quantity),0) AS
  quantity_on_hand` — safe under `ONLY_FULL_GROUP_BY` since the GROUP BY key
  is the `pa` table's primary key. No N+1.
- `GET /inventory/transactions` (new, `src/routes/inventory.js`) — org-scoped
  via `(i.organization_id = ? OR i.organization_id IS NULL)` through a
  3-way JOIN (`inventory_transactions` → `inventory_stock` → `inventory_items`
  + `warehouses` for the name), `limit`/`offset` (not `page`/`limit` — brief
  was explicit), filters `item_id`/`stock_id`/`transaction_type`.
- **OpenAPI**: `jsonBody()`/`r200()`/`r201()` in this codebase are ALWAYS
  generic `{type:'object'}` — the `desc` string is cosmetic, never a `$ref`.
  So editing `addInvoiceItem`/`createQuoteItem`/`createPlanAddon` in
  `src/middleware/schemas/*.js` auto-flows into `components.schemas` on
  `pnpm run openapi` with **zero manual path edits needed** (see
  [[openapi-pattern]]) — I only had to hand-add the two genuinely NEW paths
  (`GET /inventory/transactions`, `GET+POST /plans/addons`). Confirmed via
  `git diff --stat docs/openapi.json` being purely additive (153 lines, 0
  deletions) after `pnpm run openapi`.
- Frontend: `frontend/src/api/addonCatalog.ts` (new shared helper,
  `fetchAddonCatalog`/`addonPrice`/`addonQuantityOnHand`, mirrors
  `GenerateInvoiceModal.tsx`'s private `fetchAddonCatalog` but exported so
  both Detail pages can share it without touching that file). `InvoiceDetail.tsx`
  had **zero** add-item UI before this PR (only `POST /invoices/generate`
  existed) — built its first-ever `AddInvoiceItemForm`, mirroring
  `QuoteDetail.tsx`'s existing `AddItemForm` pattern (recompute-and-PUT
  subtotal/tax/total from the fraction `tax_rate`, same rounding). Both
  pages' add-item forms gained an optional `<select>` product picker: picking
  an entry autofills description/unit_price and tags `inventory_item_id`;
  leaving it on the default option keeps the free-text path identical to
  before. Negative/zero `quantity_on_hand` renders red via `<option
  style={{color:'#dc2626'}}>` (native `<select>` — this DOES apply per-option
  in jsdom/Chrome/Firefox; Safari support is weaker but acceptable for admin
  tooling). `InventoryManagement.tsx` gained a 6th "Movements" tab (chosen
  over `InventoryList.tsx` — Movements is a read-only ledger view, fits this
  page's existing tabbed-dashboard pattern with `styles`/`t()` already wired,
  vs. `InventoryList.tsx`'s per-item-modal CRUD pattern).
- **Incidental fix, in-diff**: `InventoryList.tsx`'s `StockModal` color logic
  was `row.quantity === 0 ? red : green` — a negative quantity never matched
  `=== 0`, so it rendered GREEN. Required by brief item 12 ("negative
  quantity renders red wherever stock is shown") and trivial to fix inline;
  added `row.quantity < 0 ? red :` as the first branch.

## Explicitly NOT built (brief said to skip, or report-not-fix)

- **No reversal path**: `invoice_items`/`quote_items` have no PUT/DELETE
  route at all (confirmed by full-file read + grep) — items are append-only.
  Brief said explicitly: if there's no delete route, state so and skip
  reversal. Did not add one (would be scope creep — reversal semantics for
  an append-only table imply designing a whole new mutation surface).
- **Voiding an invoice does not restore stock** — `billingService.voidInvoiceById`
  never touches `invoice_items`/inventory at all (pre-existing, confirmed by
  reading it). Flagged, not fixed — out of scope (brief only asked about
  item-DELETE reversal, not void-triggered reversal).
- `POST /invoices/generate` / `POST /quotes/generate`'s `type: 'product'`
  item handling was deliberately NOT touched — brief scoped the picker to
  `InvoiceDetail`/`QuoteDetail`'s add-item forms only, not the Generate
  modals. `GenerateInvoiceModal.tsx`/`GenerateQuoteModal.tsx` still resolve
  "product" as free text with no catalog/inventory awareness — a real gap,
  but explicitly out of this brief's scope (would need
  `productAddonId`→server-side lookup wiring the audit doc already flagged
  as a separate, harder change).
- `crudPaths('inventory', 'Inventory', 'InventoryItem')` in `openapi.js`
  still documents the WRONG paths (`/inventory`, `/inventory/{id}` — real
  routes are `/inventory/items*`), a pre-existing Phase 1 gap. Added a code
  comment pointing at it; did not fix (unbounded scope — would mean adding
  the full real `/inventory/items` CRUD path family + removing the wrong
  crudPaths call).

## Testing patterns that worked

- New backend suite `tests/inventoryPhase2ProductLinkage.test.js` — auth
  dispatcher must match on `` sql.includes('`users`') `` (backtick-quoted,
  from `BaseModel`), NOT the looser `sql.includes('WHERE id = ?')` pattern
  used in `inventoryTransactions.test.js` — the looser pattern collides with
  `Invoice.findById`'s `` SELECT * FROM `invoices` WHERE id = ? AND
  deleted_at IS NULL `` when a test's flow reaches a second BaseModel lookup
  after auth (e.g. convert-to-invoice's final `Invoice.findById`).
- Query-string filter values arrive as **strings** in Express (`req.query.item_id
  === '7'`, not `7`) — this route pushes them into SQL params unconverted
  (matches `auditLogs.js`'s existing house style), so tests must assert
  string params, not numbers, when asserting on filter-query param arrays.
- `jest.spyOn(realBillingServiceModule, 'nextInvoiceNumber')` works fine for
  a test file that does NOT `jest.mock()` the whole service module — cheaper
  than replicating `nextInvoiceNumber`'s real `INSERT IGNORE`/`UPDATE` SQL
  shape in the `conn.execute` mock dispatcher for a test that isn't about
  that function.
- Frontend: adding a product-catalog `<select>` to a page whose vitest mock
  of `@/api/client` only exported `{ api, tokenStore }` (no `authedFetch`)
  did NOT crash existing tests — `useQuery`'s queryFn throwing synchronously
  (calling `undefined(...)`) just resolves to `isError`/`data: undefined`,
  and `const { data: catalog = [] }` degrades to an empty, hidden picker.
  Existing tests kept passing with zero changes needed — but NEW tests that
  actually exercise the picker need `authedFetch` added to that mock's
  factory (`mockAuthedFetch`, wired to return `{data: productCatalog}`).
- `getByText('-3')` / any single-digit-or-short quantity string is a landmine
  when a page shows the same number in two places (a "Total: -3" summary
  AND a per-row cell) — use `getAllByText(...)` and disambiguate by
  `el.tagName` or a nearer scope, don't assume `getByText` uniqueness for
  small numeric strings.
- A native `<option style={{color: '#dc2626'}}>` renders as
  `option.style.color === 'rgb(220, 38, 38)'` in jsdom (hex converted to
  rgb()) — assert against the rgb() form, not the hex string, when testing
  inline option styles.
