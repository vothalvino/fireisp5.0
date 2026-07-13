---
name: diag-engine-blindness-client-id-fix
description: supportConversations.js routes were reading conv.client_id off a {conversation,messages} wrapper (always undefined); diagnosticEngineService._buildResult reported a false "clean bill of health" when every check was 'unknown'; devices.client_id was unsettable (no schema field, no fillable entry), permanently starving the ONU resolver.
metadata:
  type: project
---

Branch `fix/diagnostic-engine-blindness-client-id` fixed three compounding bugs
in the §21 AI diagnostic flow. All three were **live**, not latent — every
`POST /support/conversations/:id/diagnose` call and every follow-up AI chat
reply lost customer context before this fix.

## Bug 1 — `conv.client_id` vs `conv.conversation.client_id`

`supportConversationService.getConversation()` / `_loadConversation()`
returns `{ conversation, messages }` (confirmed intentional — `GET
/conversations/:id` and `frontend/src/pages/AiSupportPage.tsx` both depend on
this wrapper shape as the public contract, so it must NOT change). But
`src/routes/supportConversations.js`'s POST `/messages` and POST `/diagnose`
handlers read `conv.client_id` (flat) — always `undefined`. Since
`src/config/database.js` uses `pool.execute()` (prepared statements), mysql2
hard-rejects `undefined` bind params, which every per-check try/catch in
`diagnosticEngineService.js` swallows into `status:'unknown'`. Net effect:
diagnose was ALWAYS blind, and every follow-up AI reply (not just diagnose)
silently lost billing/contract/device context enrichment
(`supportContextService.enrichContext` only runs `if (clientId)`).

**Fix:** read `conv.conversation.client_id` at both call sites. Two lines.

**How to apply:** when a service function's docstring/JSDoc says it returns a
wrapper object, grep every caller for `.field` access, not just
`.wrapperKey.field` — a flat-looking property access on a wrapper-returning
function is invisible at review time and mysql2 turns it into a *silent*
`'unknown'` everywhere, not a crash.

## Bug 2 — `_buildResult` conflated "clean" with "blind"

`diagnosticEngineService.js`'s `_buildResult(checks, defaultRecommendation)`
only branched `cause`/`recommendation` on `errorChecks.length > 0` — it never
checked `knownChecks` (checks whose status isn't `'unknown'`). A run where
every single check came back `'unknown'` (total service unavailability, e.g.
bug 1 above) produced the exact same `'No critical issues detected'` text as
a run that genuinely verified everything is healthy — a **false negative**
reported to a human support/technician agent as fact.

**Fix:** added a `blind = checks.length > 0 && knownChecks === 0` branch that
reuses `_genericResult`'s existing honest zero-data phrasing (`'Unable to
determine specific cause — manual review required'` /
`'Please contact technical support for assistance.'`). Strict zero floor
(not a fuzzy threshold like `confidence < 0.2`) — deliberate, to avoid new
false positives without a live repro to calibrate a fuzzier cutoff against.

**Test gotcha:** to simulate "every check unknown" in a test, mocking
`db.query` to reject is NOT enough — `_diagSlowFiber`'s first check
(`pppoe_session`) calls `radiusService.getSessionByClientId` directly, not
via `db.query`. If that mock isn't also made to reject, it resolves to
`undefined` → `session` falsy → status `'warning'` (a *known* check),
producing `confidence: 0.2` instead of `0` and silently failing the "fully
blind" test scenario. Mock both.

## Bug 3 — `devices.client_id` was unsettable

`devices.client_id` (schema.sql, FK to clients, nullable) had no field in
`src/middleware/schemas/devices.js` (`createDevice`/`updateDevice`) and was
absent from `Device.fillable` — `BaseModel.update()`/`create()` silently
dropped it (200 OK, field unchanged). This meant
`diagnosticEngineService._resolveOnuDeviceId`'s direct `devices.client_id =
?` lookup was **permanently dead** — every ONU could only ever be reached
through the `cpe_devices` bridge (`cpe_devices.device_id` → `devices.id`),
and the bridge resolver (`_resolveCpeDeviceId`) never checked `devices.type`
on the far end — nothing stopped a bridge row from pointing at an
`'onu'`-typed device and being misclassified as wireless CPE (or vice versa),
since `cpe_devices.device_id` has zero server-side type guard
(`src/middleware/schemas/cpeDevices.js` only checks `type:number, min:1`).

**Fix (Part A):** added `client_id: {type:'number', min:1}` to both schemas
(no `required`; a device can have no client — POP infra). Added `'client_id'`
to `Device.fillable`. Added an org-scope FK guard
`assertDeviceClientFk(body, orgId)` in `src/routes/devices.js` — mirrors the
existing `assertServiceOrderFks` pattern in `src/routes/serviceOrders.js`
(PR #388), with one deliberate difference: it explicitly skips the check when
`client_id === null` (`assertServiceOrderFks` doesn't special-case null,
since none of its FK fields are ever legitimately cleared to null by the UI —
`devices.client_id` is). Wired as: inline middleware between `validate()` and
`ctrl.create` for POST (no `beforeCreate` hook exists in `crudController`),
direct call in the custom PUT handler (right after `findByIdOrFail`, before
`Device.update`), and `beforeUpdate` option passed to `crudController(...)`
for PATCH.

**Fix (Part B):** `_resolveOnuDeviceId` now tries the direct `client_id`
lookup first, then falls back to the `cpe_devices → contracts → devices`
bridge filtered to `d.type = 'onu'` (covers devices onboarded via TR-069
before this fix, or any future bulk-import path that never sets
`devices.client_id` directly). `_resolveCpeDeviceId` now joins back to
`devices` and restricts to `d.type IN ('indoor_cpe', 'outdoor_cpe')` — the
two resolvers are now mutually exclusive by `devices.type`, not by which
table happened to answer first.

**Existing test survived unchanged (verified, not just claimed):** the two
pre-existing `diagnosticEngineService` device-inference tests in
`tests/section21.test.js` mock `db.query` by broad SQL-text regex
(`/FROM devices\b/i && /type = 'onu'/i` for the direct lookup; `/FROM
cpe_devices/i && /JOIN contracts/i` for the bridge/CPE lookup). The new
bridge query in `_resolveOnuDeviceId` matches the *second* regex too (it has
`FROM cpe_devices` + `JOIN contracts`), returns a row shaped `{device_id:
77}` from that test's mock, and `bridged[0]?.id` (not `.device_id`) correctly
comes back `undefined` — the mismatched mock row shape is what makes the old
test still pass through to the real CPE resolver unchanged. Don't "fix" that
mock shape without re-verifying both tests.

## Deviation from the fix spec: OpenAPI regeneration WAS required

The `diag-client-id` spec claimed "No OpenAPI change needed" because
`/devices` paths use the generic `crudPaths()` helper whose request bodies
are untyped `{type:'object'}`. That's true for the **paths**, but wrong for
the overall `spec:check` gate: see [[openapi-pattern]] —
`generateSpec()` auto-loads `components.schemas` from every file in
`src/middleware/schemas/` unconditionally, so adding `client_id` to
`devices.js`'s schemas changed `components.schemas.devices_{createDevice,
updateDevice,patchDevice}` even though no path `$ref`s them. `pnpm run
openapi` was required; `pnpm run spec:check` failed on the `components`
section until it was run. Always regenerate after touching a
`src/middleware/schemas/*.js` file — don't reason your way out of it from the
path-body-typing angle alone.

## Adversarial-review round (same PR, 2 confirmed findings)

1. **HIGH — `discoveryScans.js`'s onboard route bypassed the new client_id
   guard entirely, plus a pre-existing organization_id cross-tenant hole.**
   `POST /:id/results/:resultId/onboard` (src/routes/discoveryScans.js)
   builds a `Device.create()` payload from `...req.body` with no
   `validate()` schema and no org guard. Once this PR made `client_id`
   fillable, an org-A caller with `discovery_scans.update` could set
   `client_id` to any org-B client id — Device.create would silently accept
   it, completely bypassing the `assertDeviceClientFk` invariant this PR
   established on `/devices`. Separately (pre-existing, independent of this
   PR): the old field order was `{ organization_id: req.orgId, ...,
   ...req.body }` — spreading `req.body` LAST meant a caller-supplied
   `organization_id` in the body silently overrode the caller's own org,
   letting an org-A caller create a device that belongs entirely to org B.

   **Fix:** extracted `assertDeviceClientFk` out of `src/routes/devices.js`
   into a new shared module `src/services/deviceAuthz.js` (follows the
   `assertPlanSelectable` precedent — see
   `src/services/planAvailability.js` — of promoting a route-local FK guard
   to `src/services/` once a second route needs it; do NOT export
   route-to-route). Both `devices.js` and `discoveryScans.js` now import it.
   Reordered `deviceData` in the onboard handler so `...req.body` is spread
   **before** the explicit `organization_id: req.orgId` (and added the
   `assertDeviceClientFk` call before `Device.create`) — in a JS object
   literal, a key's LAST occurrence wins, so putting the server-authoritative
   field after the spread is what makes it actually authoritative. This is a
   general pattern worth checking anywhere `{ organization_id: req.orgId,
   ...req.body }` (fixed order) appears — grep for that shape elsewhere if
   auditing other routes.

2. **LOW — silent wrong data: direct ONU lookup was missing
   `deleted_at IS NULL`.** `_resolveOnuDeviceId`'s direct `devices.client_id`
   lookup (src/services/diagnosticEngineService.js) had no soft-delete
   filter, unlike its own bridge fallback and `_resolveCpeDeviceId`. A
   soft-deleted (replaced/decommissioned) ONU that still had `client_id` set
   would short-circuit the resolver and report stale optical metrics as the
   customer's live status, never falling through to the bridge to find the
   real replacement device. One-line fix (`AND deleted_at IS NULL`); this is
   an easy class of bug to reintroduce when copy-pasting one resolver
   variant to write another — the two resolvers in this file should be kept
   in lockstep on which soft-delete/status filters they apply.

## Flagged, not fixed (out of scope for this PR, reported to the user)

- `supportConversationService._generateResponse` (line ~118) looks up
  `diagnosticEngine.generateSupportResponse`, a function
  `diagnosticEngineService.js` does not export (`module.exports = {
  runDiagnostic }` only) — technical-intent AI auto-replies always fall
  through to the generic Spanish fallback text. A silent stub, not a crash.
- No device-edit UI exists to set `client_id` from the product —
  `DeviceDetail.tsx` is read-only. Backend-only fix; a technician/admin still
  has no in-app way to link an ONU to a client.
- `tests/section21.test.js`'s regex-based `db.query` mock dispatch (see
  above) is fragile by construction — broad SQL-text regexes rather than
  precise per-query matchers. Works today but is a maintenance trap for the
  next SQL rewrite in this file.
