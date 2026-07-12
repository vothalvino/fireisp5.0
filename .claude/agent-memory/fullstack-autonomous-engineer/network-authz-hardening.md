---
name: network-authz-hardening
description: PR fix/network-authz-hardening (2026-07-12) — plan/FK org-scoping + RADIUS status lifecycle on suspend/terminate/cancel; what's fixed vs. deliberately left as a flagged gap.
metadata:
  type: project
---

Fixed three verified pre-existing defects (branch `fix/network-authz-hardening`):

1. **Cross-org plan assignment** — `assertPlanSelectable` (was local to
   `src/routes/contracts.js`) moved to `src/services/planAvailability.js`,
   now takes `orgId` and filters `AND (organization_id = ? OR
   organization_id IS NULL)`, org branch skipped when orgId is null. Shared
   by contracts.js (create/PUT/PATCH/renew) AND serviceOrders.js (Bug 3).
   `lifecycleService.js#startOrder` keeps its OWN pre-existing inline
   duplicate of this check (route->service import-cycle avoidance) —
   deliberately NOT refactored to use the shared helper, left as-is since it
   was already correct/tested.

2. **RADIUS status never synced to contract lifecycle** —
   `suspensionService.suspendContract`/`reconnectContract` now flip
   `radius.status` (guarded: suspend only touches 'active' rows, reconnect
   only touches 'suspended' rows — reconnect deliberately never resurrects
   'inactive'/terminated credentials). `softSuspendContract` intentionally
   left untouched (walled-garden needs radius to STAY 'active'). Contract
   terminate route (`POST /contracts/:id/terminate`) now explicitly flips
   radius to 'inactive' (unconditional, mirrors `lifecycleService.cancelOrder`)
   instead of reusing `suspendContract` purely for its CoA side-effect (that
   reuse was itself a latent bug — it logged a misleading 'suspend'
   `suspension_logs` row and transiently set `contracts.status='suspended'`
   right before overwriting it with 'terminated'). Renew route gained a
   companion fix: reactivates an existing-but-'inactive' radius row (a
   renew is an explicit staff action, unlike the automatic
   billing-driven reconnect, so it MAY resurrect credentials).

   **Important scope-defining discovery**: the frontend's Cancel button
   (`ContractList.tsx` `patchContractStatus(id, 'cancelled')`) is a raw
   `PATCH {status:'cancelled'}` — it does NOT go through the dedicated
   `/terminate` route. `updateContractHandler` (shared by PUT/PATCH) had ZERO
   radius handling. Added a targeted fix there: on a status transition INTO
   `terminated`/`cancelled`/`expired` via generic PATCH/PUT, deactivate radius
   + best-effort CoA disconnect.
   **CORRECTED in the adversarial-review round below** — the "PATCH
   suspend/reactivate is never used by the frontend" assumption in this
   paragraph was WRONG: the Edit Contract modal (`ContractList.tsx
   EDIT_STATUSES`) is a PUT that legally drives active<->suspended too. See
   item 6.

3. **Service-order FK org-scoping** — `assertServiceOrderFks(body, orgId)`
   helper in `src/routes/serviceOrders.js` checks whichever of
   client_id/lead_id/plan_id/contract_id is present in the body (via
   `Model.findById(id, orgId)` for the first two/last, and the shared
   `assertPlanSelectable` for plan_id), wired as `crudController`'s
   `beforeUpdate` hook for PUT/PATCH and called directly at the top of
   `POST /` (inside the transaction, before any write). Note:
   `crudController`'s `beforeUpdate` option is the general-purpose hook for
   exactly this kind of guard — check for it before hand-rolling FK
   validation in a route handler.

**Follow-up round (same day, coordinator asked to fold both flagged items in)**:

4. **`POST /bulk/suspend` now routes through `suspensionService.suspendContract`**
   per contract_id (SELECT-then-suspend, same `{success, failed, errors[]}`
   response shape — no frontend caller exists for this endpoint, verified via
   grep, so no caller alignment was needed). Verified there is no analogous
   bulk reconnect/unsuspend/terminate endpoint anywhere in the codebase (only
   `/bulk/suspend` exists) — nothing else needed the same fix.

   **Bigger discovery while implementing this**: `src/routes/bulk.js` never
   applied `orgScope` middleware AT ALL (only `authenticate`) — `req.orgId`
   was `undefined` for every route in this file (`/bulk/invoices/void`,
   `/bulk/invoices/generate`, `/bulk/suspend`, `/bulk/email`). Any org-scoped
   query bound `undefined` as a bind param, which mysql2 rejects at the
   driver level ("Bind parameters must not contain undefined") — a real,
   currently-live 500 on every call against real MySQL, including
   `/bulk/invoices/void` which IS wired into the frontend
   (`InvoiceList.tsx`). Invisible to `pnpm test` because the DB is fully
   mocked and `db.query.mockResolvedValue(...)` returns its queued value
   regardless of what (broken) params it received. Added `router.use(orgScope)`
   — a one-line, necessary prerequisite for my own org-scoped SELECT in the
   suspend loop to work at all, not scope creep for its own sake.

5. **`ServiceOrder.fillable` narrowed** — removed `status`, `approved_at`,
   `approved_by`, `activated_at`, `cancelled_at`, `started_at`, `completed_at`.
   Verified via grep: nothing calls `ServiceOrder.create`/`ServiceOrder.update`
   directly anywhere in `src/` (POST / hand-builds its INSERT from `fillable`
   directly; PUT/PATCH go through `crudController` -> `Model.update`, the
   only real caller) — migration 380's own comment confirms
   approved_at/approved_by/activated_at are historical-only, no longer
   written by anything. `status ENUM(...) NOT NULL DEFAULT 'new'` at the DB
   layer means POST / needs no explicit status write. **Side effect**:
   `BaseModel.sortable` defaults to `[...fillable, 'id', 'created_at',
   'updated_at']`, so `GET /service-orders?order_by=status` (or any of the
   removed timestamp columns) now silently falls back to `id` — verified no
   test or frontend code (`ServiceOrderList.tsx`) uses `order_by` on this
   endpoint, so left as an accepted, reported side effect rather than adding
   an unrequested `sortable` override to preserve it.

**Still flagged, not fixed** — `ServiceOrder`'s generic-PATCH-bypasses-FSM bug
shape doesn't fully generalize to other models; did not go audit every other
`crudController`-backed model's `fillable` list for the same pattern (state
columns writable via undeclared-but-fillable fields) — worth a follow-up pass
if this class of bug matters project-wide.

**Adversarial-review round (same day, 3 confirmed findings, 2/2 verifier
votes each)**:

6. **HIGH — `updateContractHandler`'s radius sync was incomplete.** Item 2's
   PATCH/PUT fix above only covered transitions INTO
   `terminated`/`cancelled`/`expired`, on the (wrong) assumption that
   suspend/reactivate always go through the dedicated `/suspend`/`/renew`
   routes. Actually checked the frontend this time: `ContractList.tsx`'s
   `EditContractModal` (`EDIT_STATUSES = ['pending','active','suspended',
   'cancelled','terminated']`) is a **PUT** whose mutation body always
   includes `status: form.status` — the FSM trigger legally permits
   `active->suspended` and `suspended/expired/cancelled/terminated->active`
   through this same generic handler. Two live bugs: (a) editing a contract
   to 'suspended' via this modal left radius `'active'` — subscriber just
   re-dials, suspend is cosmetic through this path; (b) editing a suspended
   (or previously-terminated/cancelled) contract back to 'active' left
   radius `'suspended'`/`'inactive'` — contract shows active, service stays
   dead. (b) was a **regression introduced by item 2 of this same PR** — before
   PR #388, radius.status was never touched at all, so there was no
   'suspended'/'inactive' state to strand a reactivated contract in.

   Fix: replaced the single `terminated/cancelled/expired`-only branch with
   a 3-way switch on the NEW status covering every transition the FSM lets
   through this handler: `->suspended` (radius active->suspended + CoA
   disconnect), `->active` (radius `suspended OR inactive` -> active in ONE
   guarded UPDATE + CoA reconnect via `sendRadiusCoA(id,'reconnect')` —
   deliberately mirrors `/renew`'s "may resurrect an inactive account"
   behavior, since the FSM allows terminal-state -> active through this
   generic handler too), `->terminated/cancelled/expired` (unchanged,
   radius -> inactive + CoA disconnect). See `src/routes/contracts.js`
   `updateContractHandler` for the full transition-table comment.

   **Lesson for future scope decisions**: when reasoning "the frontend
   never does X" to justify narrowing a fix, actually grep the frontend
   for the relevant mutation/form before asserting it — I got this
   specific claim wrong the first time and it took an adversarial review
   pass to catch.

7. **LOW — bulk-suspend pre-filter let non-suspendable statuses hit the FSM
   trigger.** The pre-filter only skipped `status === 'suspended'`;
   pending/cancelled/terminated/expired contracts fell through to
   `suspendContract`, which has no status guard of its own, and failed with
   the DB trigger's raw `'Invalid contract status transition'` message
   instead of a clear per-row error. Changed the filter to require
   `status === 'active'` and report every other status (including
   `'suspended'` itself) as `` `Cannot suspend a '<status>' contract` ``
   — `Not found` stays a distinct message for a missing/cross-org id.

8. **Rebase onto main** after this PR's base moved twice (#387 CSV
   contract import + ClientFormModal, #389 atomic invoice numbering +
   payment-method enum) — no file overlap with this PR's product code;
   only conflict was the `MEMORY.md` index (both branches appended lines) —
   resolved by keeping both sides' new entries.

See [[testing-conventions]] for the general test-mocking patterns; the key
one exercised heavily in this PR: `jest.fn()` calls beyond queued
`mockResolvedValueOnce` values return `undefined`, which is harmless for
`await db.query(...)` calls whose result isn't destructured — but destructuring
(`const [rows] = await db.query(...)`) on an unmocked call throws. When
inserting a new intermediate DB call into an existing code path, audit every
test that mocks that path's `db.query`/`conn.execute` sequence positionally
and either insert a matching mock or confirm the new call isn't destructured.
