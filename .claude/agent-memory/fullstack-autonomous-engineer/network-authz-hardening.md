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
   + best-effort CoA disconnect. Deliberately did NOT mirror the
   REACTIVATION direction (suspended/terminal -> active) via generic PATCH —
   the frontend never does that (uses `/renew` instead, per its own code
   comment), and the dedicated `/suspend` route's exemption-check +
   structured logging is the only sanctioned way to enter 'suspended'.

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

**Deliberately NOT fixed (flagged only, told to user in the PR/report)**:
- `POST /bulk/suspend` (`src/routes/bulk.js`) does a raw
  `UPDATE contracts SET status='suspended' ...` entirely bypassing
  `suspensionService.suspendContract` — no CoA disconnect, no radius flip,
  no suspension-exemption check. Same symptom class as Bug 2 but via a
  different, un-mentioned code path; not touched (would require rewriting
  the bulk loop to call the service, a bigger behavior change than this PR's
  scope).
- `ServiceOrder.fillable` includes `status`/`approved_at`/`activated_at`/etc.
  that are NOT declared in `updateServiceOrder`/`patchServiceOrder`'s
  validate() schema — since `validate()` doesn't strip undeclared fields by
  default, a raw PATCH `{status:'done'}` can bypass `lifecycleService`'s
  entire FSM (locking, contract activation, invoicing) and write the column
  directly. Same "generic PATCH bypasses the workflow" bug SHAPE as the
  contracts.js Cancel-button discovery above, but for service_orders — much
  larger blast radius to fix (changes validate() semantics or requires an
  explicit reject-list), left as a flagged gap.

See [[testing-conventions]] for the general test-mocking patterns; the key
one exercised heavily in this PR: `jest.fn()` calls beyond queued
`mockResolvedValueOnce` values return `undefined`, which is harmless for
`await db.query(...)` calls whose result isn't destructured — but destructuring
(`const [rows] = await db.query(...)`) on an unmocked call throws. When
inserting a new intermediate DB call into an existing code path, audit every
test that mocks that path's `db.query`/`conn.execute` sequence positionally
and either insert a matching mock or confirm the new call isn't destructured.
