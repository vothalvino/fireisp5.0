---
name: inventory-followups-sellable-items-undo-install
description: Inventory follow-ups (§14.2 cont'd, migration 392) — items sellable directly on invoices/quotes (union picker) + undo-install (void-before-reversal ordering, unpaid = SUM(payment_allocations)=0)
metadata:
  type: project
---

Built on branch `feat/inventory-items-sellable-undo`, based on origin/main @
c5b8d7d (includes Phases 1-3, migrations ≤391, PRs #410/#412/#413). Not
pushed/PR'd per brief — local commit only. Two independent features from one
brief, both grounded in real demo usage pain (items not sellable without a
manual addon detour; no way to undo a mistaken install).

## Feature A — items sellable directly (no schema change)

- `crudController.list` cannot express a `JOIN`+`GROUP BY` (it only calls
  `Model.findAll`/`Model.count`, both plain single-table SELECTs). The fix
  pattern: add a model method (`InventoryItem.findAllWithStock`) that
  mirrors `BaseModel.findAll`'s filter/sort/pagination contract EXACTLY
  (same fillable-column filter whitelist, same soft-delete/org-scope
  handling, same LIMIT/OFFSET literal-interpolation safety) but with a
  grouped `LEFT JOIN inventory_stock` — then hand-roll the route handler
  around it instead of `ctrl.list`, keeping the response byte-identical in
  shape plus the new field. Used **hardcoded literal table/column names**
  (`inventory_items`, not `` `${this.tableName}` ``) since this method only
  ever serves one model — keeps the SQL maximally parseable by
  `sql:check` (which already tolerates `BaseModel.findAll`'s own dynamic
  `${this.tableName}` by skipping it, but a literal is strictly safer and
  costs nothing here).
- `quantity_on_hand` is a `COALESCE(SUM(s.quantity), 0)` aggregate — mysql2
  returns SUM() results as **strings** (DECIMAL promotion rule, same as
  [[mysql2-decimal-string-gotcha]]), confirmed by mirroring `Plan.getAddons`'s
  existing `addonQuantityOnHand` defensive-parse convention. The
  `InventoryManagement.tsx` Stock tab's `fetchInventoryItems` now
  `Number()`-casts it post-fetch so the pre-existing (always-dead-until-now)
  low-stock filter/color logic works correctly instead of silently
  comparing a string.
- **Product-picker union + de-dupe** (`frontend/src/api/addonCatalog.ts`):
  `buildProductPickerEntries(catalog, items)` merges the curated
  `plan_addons` catalog with active `inventory_items` not already linked by
  one of those addons (curated entry wins on overlap — `Set` of
  `addon.inventory_item_id`). **Id-namespace collision**: `plan_addons.id`
  and `inventory_items.id` are separate sequences that can collide (both
  start at 1). Existing tests/behavior already select an addon via a BARE
  numeric `<option value>` string (`String(addon.id)`) — changing that
  scheme would break every existing picker test. Fix: keep addon options
  bare-numeric (backward compatible, zero existing-test changes needed) and
  give raw-item options an `item-<id>` PREFIXED value — a string that can
  never collide with a bare numeric id. `selectProduct`/`handleSubmit` in
  `InvoiceDetail.tsx`/`QuoteDetail.tsx` now resolve against the merged
  `entries` array by `.value` instead of `catalog.find(a => String(a.id) ===
  id)`.
- Extended this union into `GenerateInvoiceModal.tsx`/`GenerateQuoteModal.tsx`
  too (their OWN private `PlanAddon`/`fetchAddonCatalog`/`addonPrice` were
  deleted, replaced with the shared `addonCatalog.ts` exports) — **but**
  confirmed first that `POST /invoices|quotes/generate`'s flexible
  `type:'product'` handling has NEVER carried `inventory_item_id` through
  to the created line (pre-existing Phase 2 gap, `src/routes/invoices.js`'s
  `/generate` route only does `{description, quantity, unit_price}` for
  product/custom types) — so extending the picker here is UI-consistency
  only, not a new capability; explicitly did not touch the backend generate
  routes (that's a materially bigger change: drawdown-at-generation-time
  semantics, out of this brief's numbered scope). Documented inline as a
  known, unchanged limitation.
- `plan_addons.description` has existed since migration 111 (table
  creation) but `createPlanAddon` schema + the `POST /plans/addons` INSERT
  never accepted it — a silent-drop bug, fixed as a ride-along (schema +
  INSERT column list + a new test). Confirmed no frontend UI creates
  `plan_addons` at all (no addon-creation form exists anywhere in
  `frontend/src/`) — nothing to wire there.
- **Test-mock gotcha that cost two retries**: `GenerateInvoiceModal.test.tsx`
  /`GenerateQuoteModal.test.tsx`/`QuoteDetail.test.tsx` all used a BLANKET
  `mockAuthedFetch.mockResolvedValue({...ADDONS})` (not URL-branching,
  unlike `InvoiceDetail.test.tsx` which already branched). Adding a SECOND
  `authedFetch` call (the new `/inventory/items` fetch) to a component
  under test silently leaks the SAME fixture into it too — harmless for
  exact-id-value selects (disjoint `item-<id>` vs bare-id value namespace
  prevents wrong-selection), but DOES break ambiguous `findByRole('option',
  {name: /Static IP/})`-style regex queries (now TWO options match: the
  real addon "Static IP (50.00)" and a bogus "Static IP (0.00)" leaked from
  the mis-typed items fetch) — `getByRole`/`findByRole` throw on multiple
  matches. Fix: always branch test HTTP mocks by URL from the start, even
  for a single-endpoint component — a future second fetch will otherwise
  silently share the wrong fixture.

## Feature B — undo-install (migration 392: `cpe_devices.sale_invoice_id`)

- New `POST /cpe-management/devices/:id/uninstall` (`cpe_inventory.manage`,
  reuses migration 391's slug, no new permission) —
  `inventorySerialService.uninstallEquipment`. Distinct from the pickup flow
  (`ensurePickupWorkOrder`/`completePickupUnit`): pickup owns POST-cancellation
  returns; undo is for a mistake on a still-LIVE contract — 422s with a
  "use the pickup flow" message if `unit.contract_id`'s contract is
  `cancelled`/`terminated`.
- **FSM gap found by walking the actual transition table** (same lesson as
  Phase 3's `assigned→rma` gap): `cpeInventoryService.TRANSITIONS.assigned`
  already allowed `→ in_stock`, but `TRANSITIONS.active` did NOT — only
  `['returned', 'rma']`. Undo must work for a unit that already came online
  (`active`), not just one still `assigned`. Added `'in_stock'` to
  `TRANSITIONS.active`. This flipped a PRE-EXISTING test
  (`tests/cpeInventory.test.js`: `'active → in_stock is NOT allowed'`) —
  updated it to assert the new, correct behavior rather than working around
  it, since the old assertion encoded the exact gap being closed.
- **"Unpaid" is `SUM(payment_allocations.amount) = 0`, not a status check.**
  `invoices.status` only flips to `'paid'` when `refreshInvoicePaidStatus`
  sees `allocated >= total`; a PARTIAL payment leaves status at whatever it
  was (`issued`/`sent`/`overdue`) with some nonzero `payment_allocations`
  rows. The brief wants partial payments to ALSO block undo (not just full
  payment), so the gate is `SELECT COALESCE(SUM(amount),0) ... WHERE
  invoice_id = ? AND deleted_at IS NULL` compared to `0`, never
  `invoice.status`.
- **`billingService.voidInvoiceById` is not composable into a caller's
  transaction** — confirmed by grep: every existing call site
  (`src/routes/invoices.js`, `src/routes/bulk.js`) invokes it standalone at
  the route layer, never inside another connection's `beginTransaction()`.
  For undo-install this means the sale-invoice void and the stock/unit
  reversal CANNOT be one atomic transaction. Resolved the ordering
  deliberately: **void the invoice FIRST, then run the stock/unit reversal
  in its own transaction** — not the reverse. Reasoning: `voidInvoiceById`
  is idempotent (a second call on an already-void invoice is a documented
  no-op), so if the reversal transaction fails/rolls back AFTER a
  successful void, a retry finds the invoice already void and just retries
  the reversal cleanly. The opposite order (reversal first, then void) has
  no such safety net — a void failure after a committed reversal leaves no
  guaranteed path to still void the invoice. Documented this trade-off both
  in the service function's doc comment and in the PR report; it's an
  inherent limitation of composing with a non-transactional shared helper,
  not something fixable without changing `voidInvoiceById` itself (out of
  this brief's scope).
- Stock/ledger reversal mirrors `completePickupUnit`'s `returned` branch
  almost exactly (`resolveOrCreateStockRow` + `quantity + 1` + a `return`
  ledger row) — gated on `unit.inventory_item_id && unit.ownership` BOTH
  being truthy (a non-linked legacy/manually-assigned unit gets unassigned
  with zero stock/ledger writes, per the brief's explicit rule). Both
  `ownership='rented'` AND `ownership='sold'` tracked units get this SAME
  reversal (mirrors that BOTH decremented stock exactly once at install —
  rented via a direct `assign_to_job` ledger write, sold via
  `drawdownForSale` inside `createOneOffInvoice`); sold ADDITIONALLY
  resolves the invoice on top.
  **Adversarial-review catch (fixed same commit, not a separate PR):** the
  gate was originally just `inventory_item_id` — wrong, because
  `cpeInventoryService.linkSubscriber`/its TR-069 auto-link counterpart also
  cross `in_stock -> assigned` for a TRACKED unit WITHOUT decrementing stock
  (a pre-existing, separate gap in those two functions). A unit
  subscriber-linked (not installed) via the admin-only Subscriber Link tab
  or auto-link-on-Inform, then reached via `ClientDetail.tsx`'s Assigned
  Equipment section (which lists by `subscriber_id`, not `contract_id` —
  `ServiceOrderList.tsx`'s modal wouldn't show it), would have gotten a
  phantom `+1` stock restore on undo. `ownership` is only ever set by
  `installEquipment` (always decrements) and inherited by `swapDevice`
  (which independently decrements the incoming tracked device on its OWN
  `inventory_item_id` condition) — a much closer proxy for "stock was
  actually taken." Residual, deliberately-not-fixed edge case: `swapDevice`
  swapping in a tracked unit whose OLD device had `ownership=NULL`
  (itself never properly installed) still decrements stock (its condition
  is bare `inventory_item_id`, not `ownership`) but the new device inherits
  `ownership=NULL` — undo would then UNDER-restore for that compound,
  unusual scenario. Accepted as out of scope (an under-restore is a safer
  failure direction than an over-restore, and matches this subsystem's
  existing "negative/drifted stock allowed, never block" philosophy) —
  the real fix would be making `linkSubscriber`/auto-link/`swapDevice`
  internally consistent about when they decrement, which is a separate,
  broader change than this brief's undo-install scope.
- `installEquipment`'s sold branch now does one more write after
  `createOneOffInvoice` returns: `UPDATE cpe_devices SET sale_invoice_id = ?
  WHERE id = ?` on the SAME transaction connection — this is undo-install's
  only way to find the invoice later. Sold units installed before this
  migration have `sale_invoice_id = NULL`; undo-install still reverses
  their stock/unit state but returns a `warnings: [...]` array note that
  any sale invoice must be voided manually (can't be found automatically).
- Frontend: `UndoInstallButton` (new shared component,
  `frontend/src/components/UndoInstallButton.tsx` +
  `frontend/src/api/cpeInventory.ts`) — confirm dialog with name+serial,
  optional notes, `extractApiError`-verbatim backend error surfacing. On
  success WITH warnings, the modal stays open showing them (amber box +
  Close button) instead of auto-closing — a warning like "void the sale
  invoice manually" must be seen, not silently dismissed. Wired into
  `ServiceOrderList.tsx`'s `EquipmentModal` assigned-units list and
  `ClientDetail.tsx`'s `AssignedEquipmentSection` (which gained an Actions
  column — its first-ever mutating action; it was pure read-only before).
  Gave it its own dedicated test file rather than trying to exercise it
  through either large host page's test setup — cheaper and matches the
  brief's testing ask directly.

## Deferred / flagged, not fixed (adjacent, pre-existing, confirmed still real)

- `POST /invoices/generate` / `POST /quotes/generate`'s `type:'product'`
  items still never carry `inventory_item_id` (no drawdown, no linkage) —
  confirmed unchanged, out of scope (see Feature A section above).
- `InventoryStock` model (`src/models/InventoryStock.js`) has a `fillable`
  listing `quantity_on_hand`/`quantity_reserved`/`organization_id` — none
  of which exist on the real `inventory_stock` table (real column is
  `quantity`, no `organization_id`). Confirmed dead code (only referenced
  by a generic model test, `tests/remainingModels.test.js`; every real
  inventory route uses raw SQL, never this model). Not touched — out of
  this brief's scope, flagging for whoever eventually cleans up unused
  models.
