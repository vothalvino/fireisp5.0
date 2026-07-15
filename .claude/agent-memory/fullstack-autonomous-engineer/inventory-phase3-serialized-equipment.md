---
name: inventory-phase3-serialized-equipment
description: Inventory Phase 3 (§14.2 cont'd) — per-serial units on cpe_devices, install drawdown (rent/buy), pickup returns; migration 391 relaxes cpe_devices.oui to NULL and extends the lifecycle FSM
metadata:
  type: project
---

Built on branch `feat/inventory-phase3-serials`, based on main @ 6dcd731 (includes
Phase 1/2, migration 390, PR #412). Not pushed/PR'd per brief — local commit only.

## The architectural fork, and why the brief's choice was right

Investigation before coding found TWO candidate tables for "serialized
equipment": `cpe_devices` (TR-069/CWMP registry, migration 274/278 — already
has `lifecycle_state`/depreciation/subscriber-link, but `oui VARCHAR(6) NOT
NULL` is CWMP-specific) vs. the generic `assets`/`asset_assignments` system
(migration 306 — already PO-linked, no TR-069 lock, but no
contract_id/rent-vs-buy anywhere and no lifecycle-history audit table). The
brief explicitly named `cpe_devices` + `cpeInventoryService.transitionLifecycleState`
as the reuse target — followed it exactly rather than "improving" the design,
per the instruction to treat brief decisions as already user-confirmed. The
one real obstacle (`oui NOT NULL`) was resolved by relaxing it to `NULL` in
migration 391, documented as a deliberate, justified deviation (PO-received/
manually-registered serials have no known OUI at creation time).

## Permission gap found: EVERY cpe_* slug was 100% admin-only

Migrations 276/278 seeded `cpe_devices.*` and `cpe_inventory.*` (and
`cpe_lifecycle_history.view`) with ONLY an admin grant — no technician,
readonly, or any other role ever got them, despite the pre-existing CPE
Inventory page (`/cpe-inventory`) already being nav-visible to
`technician`-role+ users in `Layout.tsx`. This meant the entire pre-existing
CPE lifecycle/swap/subscriber-link page silently 403'd for technicians before
this migration — and would have made Phase 3's install/pickup flow (whose
primary user IS the technician) equally broken. Migration 391 grants
`cpe_devices.view`/`.create` + `cpe_inventory.view`/`.manage` to technician
(the minimum needed for Phase 3's new install/register/pickup endpoints) and
adds view-only grants to `readonly`. Left `cpe_inventory.link`/`.swap` and
`cpe_devices.update`/`.delete` admin-only — flagged, not fixed (out of this
brief's scope). `inventory.*` (used by the Register tab's item/warehouse
pickers) was ALREADY fully granted to technician since migration 119 — no
gap there.

## Schema (migration 391)

- `inventory_items.serial_required TINYINT(1) DEFAULT 0` — per-product
  toggle, default off preserves every Phase 1/2 pure-quantity flow.
- `cpe_devices.inventory_item_id` (nullable FK), `cpe_devices.ownership
  ENUM('rented','sold') NULL` — `contract_id` already existed (migration 274).
- `cpe_devices.oui` relaxed `NOT NULL` → `NULL` (see above). This also
  changes `uq_cpe_devices_serial_oui`'s real-world uniqueness: MySQL treats
  each NULL as distinct, so two inventory-sourced units sharing a
  `serial_number` with `oui` both NULL do NOT collide at the DB layer —
  accepted trade-off, documented in the migration, app-level duplicate guard
  (`_assertSerialNotTaken` in `inventorySerialService.js`) is best-effort not
  a hard constraint.
- `work_orders.work_type` ENUM +`'pickup'` (guarded `MODIFY COLUMN`, mirrors
  migration 376's enum-extension pattern exactly). No new table backs the
  pickup checklist — it's computed live from `cpe_devices WHERE contract_id=?
  AND ownership='rented' AND lifecycle_state IN ('assigned','active')`.
- No new permission slugs — see gap note above.
- `cpeInventoryService.TRANSITIONS['assigned']` gained `'rma'` as a legal
  target (was only `['active','returned','in_stock']`) — a pickup can find a
  unit damaged before it was ever activated (never went through 'active'),
  and the pre-391 FSM had no `assigned → rma` path. Found by a real test
  failure, not by inspection — a reminder to actually exercise the FSM you're
  composing into, not just read its transition table.

## What shipped

- `src/services/inventorySerialService.js` (new) — `createTrackedUnits`
  (PO-receive minting, takes a bound `execute` fn), `registerSerial`
  (manual add, catch-up vs. `increment_stock=true`), `installEquipment`
  (the drawdown: existing-serial or type-new-serial, rent vs. sold),
  `ensurePickupWorkOrder` (idempotent, best-effort), `getPickupChecklist`,
  `completePickupUnit` (auto-completes the WO when nothing rented remains).
- `src/services/inventoryDrawdownService.js` refactored: extracted
  `resolveOrCreateStockRow(execute, {orgId, itemId})` out of
  `drawdownForSale` (zero behavior change — same call sequence, confirmed by
  the pre-existing test suite passing unmodified) so Phase 3's
  assign_to_job/return ledger writes reuse the exact same
  best-guess-stock-row-with-warehouse-fallback logic instead of duplicating it.
- `src/services/billingService.js`'s `createOneOffInvoice` gained optional
  `inventoryItemId`/`performedBy` params — when set, tags the single
  `invoice_items` row and calls `drawdownForSale` **inside that same call**.
  This is how the "sold" install path raises a real invoice AND decrements
  stock exactly once: `installEquipment` never decrements for `ownership=
  'sold'`, only for `'rented'` (direct `assign_to_job` ledger write, no
  invoice). Verified with a dedicated stock-update-count-1 assertion in both
  `tests/billingService.test.js` (real drawdown path) and
  `tests/inventorySerialService.test.js` (installEquipment's own code doesn't
  double-decrement, via a whole-module `jest.mock` of billingService).
- `src/routes/purchaseOrders.js`'s `/:id/receive`: added an optional
  `serials: {[lineItemId]: string[]}` body field. Two-pass loop — pass 1
  validates every serial-required line's count against ITS delta (not
  cumulative total) BEFORE any write (422 leaves everything untouched); pass
  2 applies. Deliberately did NOT change the pre-existing
  `SELECT * FROM purchase_order_items WHERE po_id = ?` query text (kept the
  existing `tests/purchaseOrders.test.js` mock dispatcher's substring match
  working unmodified) — `serial_required` is resolved via one small
  additional `SELECT serial_required FROM inventory_items WHERE id = ?` per
  distinct item instead of joining it into the main query.
- `src/routes/cpeManagement.js`: `POST /devices/register`, `POST
  /devices/install` (both `cpe_inventory.manage`); `GET /devices` gained
  `lifecycle_state`/`inventory_item_id`/`subscriber_id`/`contract_id` filters
  and now LEFT JOINs `item_name`/`item_sku`/`subscriber_name`.
- `src/routes/workOrders.js`: `GET`/`POST /:id/pickup-items`
  (`work_orders.view`/`.update` — no new permission needed).
- `src/routes/contracts.js`: `ensurePickupWorkOrder` hooked into BOTH
  `updateContractHandler`'s terminated/cancelled/expired branch (PATCH/PUT)
  AND `POST /:id/terminate`, both fire-and-forget with `.catch()` +
  `logger.error` (mirrors the existing suspension_logs audit-write
  convention in that same file) — a pickup-creation failure must never block
  the cancellation itself.
- Frontend: `InventoryList.tsx` toggle + "Serialized" badge;
  `PurchaseOrderDetail.tsx` ReceiveModal per-line serial textarea (one per
  line) with live count-vs-needed mismatch blocking; `CpeInventoryPage.tsx`
  gained a 5th "Register" tab; `ServiceOrderList.tsx` gained an "Equipment"
  button (shown only once `contract_id` is set) opening a picker/type-new/
  rent-buy modal; `WorkOrders.tsx` shows a pickup checklist panel instead of
  `MaterialsPanel` for `work_type='pickup'` rows and hides the generic
  Complete button for them (composition auto-completes instead);
  `ClientDetail.tsx`'s Devices tab gained a read-only "Assigned Equipment"
  section fed by `subscriber_id`.

## Testing gotchas hit while building this

- **jsdom native `<select>` value-set is a silent no-op if the `<option>`
  doesn't exist yet.** `fireEvent.change(select, {target: {value: '3'}})`
  when the options are still populating from an async `useQuery` (no
  `enabled` gate) leaves the select's value unchanged — no error, no
  warning, the test just times out later waiting for a downstream effect
  that never fires. Always `await waitFor(() => expect(getByText(theOptionLabel))...)`
  before firing `change` on a select whose options come from a query.
- Added `htmlFor`/`id` pairs to `EquipmentModal`'s label/select/input trio
  (previously bare sibling `<label>`+`<select>`, no association) — both a
  genuine a11y fix and what made `getByLabelText` a viable, robust query
  instead of the fragile `getByText(...).closest('select')` pattern. Also
  added `name="equipment-serial-mode"`/`name="equipment-ownership"` to the
  radio button pairs (semantic grouping fix, incidental).
- For a stateful multi-call-site mock connection (register/install/pickup
  all mix `conn.execute` used by the service's own SQL with `conn.query`
  used internally by `cpeInventoryService.transitionLifecycleState`, which
  always reads `opts.connection.query`, never `.execute`) — the cleanest
  test double is ONE shared substring-dispatch function assigned to BOTH
  `conn.execute` and `conn.query` (and `db.query`) against a single in-memory
  state object, not sequential `mockResolvedValueOnce` queues (way too
  fragile for a 6+ SQL statement transaction with branches). See
  `tests/inventorySerialService.test.js`'s `route()`/`wireDb()` helpers —
  reusable pattern for any future service test with a similarly-shaped
  multi-table transactional flow.
- `pnpm test -- <file>` in the frontend did NOT filter to that file (ran the
  full 122-file suite regardless) — use `npx vitest run <file>` directly to
  target specific files during development.

## Deferred / flagged, not fixed (adjacent, pre-existing)

- `cpe_inventory.link`/`.swap` and `cpe_devices.update`/`.delete` remain
  admin-only (a technician can view/register/install/pick-up equipment but
  still can't use the pre-existing Subscriber Link/Swap tabs or edit/delete
  a device record) — real gap, out of this brief's scope.
- `WorkOrders.tsx`'s per-row `<>...</>` Fragment has no `key` prop —
  pre-existing (confirmed via `git show HEAD:...`, predates this branch),
  produces a harmless React dev-console warning only, not touched.
- No e2e coverage exists anywhere for purchase-orders/service-orders/
  work-orders/CPE flows (checked, confirmed) — not built (brief's "when the
  flow you touched has coverage there" condition doesn't apply).
