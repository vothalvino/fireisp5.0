---
name: service-order-simplified-flow
description: Migration 380 replaced the 5-state service-order FSM with new/in_process/done/cancelled; startOrder/completeOrder/cancelOrder are single-transaction, row-locked, org-scoped, and concurrency-guarded — do not regress to the non-atomic style
metadata:
  type: project
---

Migration 380 (`database/migrations/380_service_order_simplified_flow.sql`) replaced
`service_orders.status` ENUM('requested','approved','provisioning','activated','cancelled')
with ENUM('new','in_process','done','cancelled'). Existing rows remap:
requested/approved -> new, provisioning -> in_process, activated -> done. `started_at`
is backfilled ONLY for provisioning/activated rows (NOT approved — an approved row
remaps to 'new', i.e. not-yet-started, so backfilling it there is a bug); `completed_at`
backfilled for activated rows. `approved_at`/`approved_by`/`activated_at` columns are
kept (historical/audit) but no longer written. Also widened `clients.address` to
VARCHAR(500) to match `leads.address`. The rollback truncates `clients.address` to 255
BEFORE narrowing the column (STRICT_TRANS_TABLES aborts an in-place truncating MODIFY
otherwise), restores `activated_at`/`approved_at` best-effort from
`completed_at`/`started_at` before dropping them, and its enum-revert guard matches
BOTH the final 4-value type AND the 8-value mid-migration superset (so a rollback of a
partially-applied 380 doesn't skip the data revert while still dropping the columns).
Migration 380 also grants `plans.view` to the `support` role (INSERT IGNORE
role_permissions) — support has `service_orders.create` and now picks a real plan via
`GET /plans` in the create-order UI, so it needs plans.view too or the picker 403s
silently and support creates permanently un-startable plan-less orders.

**Routes**: `POST /service-orders/:id/approve|provision|activate` are gone, replaced by
`start`/`complete`/`cancel`. **All three are single-transaction, row-locked
(`SELECT ... FOR UPDATE`), and end in a guarded `UPDATE ... WHERE status = '<expected>'`**
— this is load-bearing, not incidental: an earlier non-atomic version (separate
`ServiceOrder.findById` + `ServiceOrder.update` calls, `Contract.findById`/`Contract.update`
outside any lock) let two concurrent `/start` calls both provision a contract, let a
`/complete` 422 (missing fee) leave a contract already activated with the order stuck
`in_process`, and let retries double-invoice. Any future change to `startOrder`/
`completeOrder`/`cancelOrder` in `src/services/lifecycleService.js` must preserve: (1) the
row lock, (2) the guarded final UPDATE (0 `affectedRows` -> `ValidationError`, never
silently ignored), (3) validating ALL inputs *before* opening the transaction for
`completeOrder` (fee/description/client-org-check happen pre-transaction so a validation
422 never touches the contract), (4) emitting `service_order.activated` only AFTER commit.

- `startOrder`: locks the order row; for `order_type='new_install'` with no `contract_id`
  yet, creates + provisions a `pending` contract **on the same connection** (live-plan
  check is duplicated here — NOT calling `routes/contracts.js#assertPlanSelectable`,
  because that helper has NO org filter at all; this copy adds
  `(organization_id = ? OR organization_id IS NULL)`, skipped entirely when `orgId` is
  null to match `BaseModel`'s single-tenant convention). Resolves the client (uses
  `client_id`, else auto-converts an unconverted `lead_id` via `convertLead()` — that
  function keeps its own separate transaction and is naturally idempotent, so it's safe
  to call outside the row lock) and re-verifies `Client.findById(clientId, orgId)` even
  when `client_id` was already set on the order — `service_orders` create/update never
  itself org-checks `client_id`/`lead_id`/`plan_id` (a pre-existing, still-open gap
  outside this flow's scope), so this check is the only thing preventing an org-A order
  from provisioning against an org-B client.
- `completeOrder`: activates a linked `pending` contract (`UPDATE contracts SET
  status='active' WHERE id=? AND status='pending'` — 0 rows matched is NOT an error, a
  real trigger SIGNAL 45000 from `trg_contracts_radius_consistency_bu` IS, and propagates
  raw so `app.js`'s `ER_SIGNAL_EXCEPTION`/errno 1644 -> 422 mapping applies), then when
  `billing='create_invoice'` calls `billingService.createOneOffInvoice({..., conn})` on
  the SAME connection. Invoice currency comes from the order's **plan** (`plans.currency`,
  fetched pre-transaction) not `Organization.getCurrency` — avoids a mixed-currency
  ledger between the install invoice and the contract's own recurring invoices.
- `cancelOrder` (new function — the route used to be a bare generic transition with no
  contract cleanup): allowed from new/in_process only. If the linked contract is still
  `pending` (i.e. auto-created by `startOrder`, never activated), cancels it AND sets
  `radius.status = 'inactive'` for its RADIUS row — **`radius.status` is a separate
  column from `contracts.status`**; `radiusServerService#findSubscriber` only accepts
  `status = 'active'`, so without this the PPPoE creds shown to the tech at Start would
  still authenticate on the NAS after the order (and contract) are cancelled. A contract
  in any OTHER status (active, terminated, ...) is left completely untouched. Also fires
  a best-effort `suspensionService.sendRadiusDisconnect()` post-commit to kick any live
  session. NOTE: `suspensionService.suspendContract`/`terminate` themselves never flip
  `radius.status` either (only send a CoA disconnect) — a suspended/terminated contract's
  RADIUS creds likely still authenticate a *new* session too; that's a pre-existing gap
  in those flows, out of scope here, surfaced but not fixed.

**billingService.createOneOffInvoice**: `tax_rates.rate` is a FRACTION (`DECIMAL(5,4)`,
e.g. 0.1600 = 16%, seeded by migration 121, rendered as `rate*100` by the frontend) —
`taxAmount = subtotal * taxPct * 100 / 100` (rounded), NOT `subtotal * taxPct / 100`.
`generateInvoice()` (billing-period recurring invoices) and `routes/invoices.js`'s
`/generate` flexible format share this same 100x-too-small bug — **intentionally NOT
fixed there**, deferred to a dedicated follow-up PR (per explicit product-owner
instruction) — don't "helpfully" fix them in an unrelated change. The function now
accepts an optional `conn` (join a caller-owned transaction — no begin/commit/release,
reads the row back via the SAME conn since a separate pool connection can't see an
uncommitted row, and re-throws raw on error so the caller's own rollback/error-mapping
applies) and an optional `currency` override (falls back to `Organization.getCurrency`
when omitted, preserving the original standalone-call behavior).

**Frontend** (`frontend/src/pages/ServiceOrderList.tsx`): the create-order modal uses
`ClientPicker`/`LeadPicker` (`frontend/src/components/`) — debounced server-search
comboboxes, not plain `<select>`s (the app has ~500 clients+; a raw `<select>` with all
of them was unusable and got flagged in review). `ClientPicker` was extended (additively
— it's also used by `SatisfactionSurveyList`/`FollowUpReminderList`/`WorkOrders.tsx`)
to browse the newest 100 on focus before typing (empty-term `GET /clients?limit=100`
already returns newest-first via that route's own default `order_by=created_at
DESC` — no backend change needed). `LeadPicker` is a near-duplicate (not a shared
generic component — kept simple/low-risk) that excludes won/lost leads client-side and
browses `GET /leads?order_by=id&order=DESC&limit=100` for the same "newest first"
default (leads.js's plain `ctrl.list` already supports order_by/order — only the
**searched** case needed a new dedicated handler, `GET /leads?search=`, mirroring
`routes/clients.js`'s LIKE-across-name/email/phone/company + exact-id pattern; falls
through to `ctrl.list` when `search` is absent, zero regression risk). Selecting a
client/lead fetches its full record (`GET /clients/{id}` or `/leads/{id}`) for the
address auto-fill (comma-joined address+city+state+zip_code, until the tech edits the
field manually — a `dirty` flag).

`GET /service-orders` is a dedicated handler (not `crudController.list`) that LEFT JOINs
`clients`/`leads` for `client_name`/`lead_name` — the table used to depend on a separate,
100-row-capped client lookup just to resolve a display name, and had **no way at all** to
identify a lead-sourced order (client_id null). Mirrors `crudController.list`'s exact
pagination/meta/filters/include_deleted semantics (reuses `ServiceOrder.fillable`/
`sortable` so the filter/sort allowlist can't drift from the model).

Create-order submit is gated on plan + exactly one of client/lead (XOR) — there's no
edit UI for a service order, so a plan-less or client-and-lead-less order would be
permanently un-startable otherwise. Cancel requires a `window.confirm` (terminal, no
undo). The post-complete "View invoice" link is gated on `can(user, 'invoices.view')` —
technicians (the primary Complete persona) typically lack it; the invoice number still
shows as plain text.

**LeadList.tsx edit** sends an explicit `null` (not an omitted key) for a
previously-non-empty optional field the user just blanked (address/city/state/
zip_code/email/phone/company) — see `.claude/agent-memory/fullstack-autonomous-engineer/
patch-diff-explicit-clear-vs-omit.md` (this repo also has a SEPARATE, likely-unintended
duplicate memory dir at `frontend/.claude/agent-memory/fullstack-autonomous-engineer/`
with the same note — worth consolidating someday). `ClientFormModal.tsx`, which the
original review comment pointed to as "the existing pattern," does NOT actually
implement this (it just omits blank optional fields, the same bug) — an open, adjacent,
out-of-scope finding.

**How to apply**: `service_order.activated` is intentionally NOT renamed even though it
now fires on `done`, not "activated" (`notificationHooks.js` listens for that literal
event name for the welcome email/SMS). See [[testing-conventions]] for the schema.sql
mojibake gotcha hit while touching the `service_orders` table comment during this work.
