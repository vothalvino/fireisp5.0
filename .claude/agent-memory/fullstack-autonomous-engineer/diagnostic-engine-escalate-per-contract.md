---
name: diagnostic-engine-escalate-per-contract
description: Migration 387 — per-contract escalation_enabled / escalate_on_disconnect toggles on `contracts`; diagnosticEngineService's escalate rule is now contract-aware (QUALITY_ESCALATE always, DISCONNECT_ESCALATE only when escalate_on_disconnect=1, escalation_enabled=0 overrides everything). Supersedes the single ESCALATE_WHEN constant in diagnostic-engine-escalate-quality-only.md.
metadata:
  type: project
---

Same branch as [[diagnostic-engine-escalate-quality-only]]
(`fix/escalate-quality-only`), extended same-day after the coordinator relayed
a scope extension from the ISP owner: the org-wide quality-only default isn't
universal — some clients want auto-escalation off entirely, some clients have
a UPS and want offline treated as a real fault. Both are now per-contract
toggles rather than a hardcoded rule.

## Migration 387

`database/migrations/387_add_contract_escalation_toggles.sql` (+ rollback,
schema.sql mirror, README bump to 001–387) adds two columns to `contracts`,
placed after `status`, before `version`:

- `escalation_enabled TINYINT(1) NOT NULL DEFAULT 1` — master switch.
- `escalate_on_disconnect TINYINT(1) NOT NULL DEFAULT 0` — additive tier.

No new permission slug — both are on the existing `Contract.fillable` +
`src/middleware/schemas/contracts.js` (`createContract`/`updateContract`,
`patchContract` auto-derives), gated by the existing `contracts.update`
permission. `BaseModel.update`/`create` filter by `fillable` automatically, so
the generic PUT/PATCH/POST handlers in `src/routes/contracts.js` needed zero
route-level changes to persist them.

## Code shape (`src/services/diagnosticEngineService.js`)

```js
const QUALITY_ESCALATE    = { onu_signal: ['error'], cpe_signal: ['warning', 'error'] };
const DISCONNECT_ESCALATE = { onu_status: ['error'], cpe_status: ['error'], pppoe_session: ['error'], radius_session: ['error'] };

function _escalatingChecks(checks, contract) {
  if (contract && Number(contract.escalation_enabled) === 0) return [];
  const map = { ...QUALITY_ESCALATE, ...((contract && Number(contract.escalate_on_disconnect) === 1) ? DISCONNECT_ESCALATE : {}) };
  return checks.filter(c => (map[c.name] || []).includes(c.status));
}

async function _resolveEscalationContract(clientId, orgId) {
  // SELECT escalation_enabled, escalate_on_disconnect FROM contracts
  //  WHERE client_id=? AND organization_id=? AND status='active'
  //  ORDER BY id DESC LIMIT 1  — never throws, null on no row/error.
}
```

`runDiagnostic` resolves the contract ONCE, up front (before the
symptom/accessType dispatch), and threads it as a new final positional param
through every `_diag*` handler (`_diagSlowFiber`, `_diagSlowWireless`,
`_diagNoInternetFiber`, `_diagNoInternetWireless`, `_diagWifi`,
`_diagDisconnects`, `_diagSlowAtNight` — all seven, even the three whose own
check names never appear in either map, for signature consistency and
future-proofing) into their `_buildResult(checks, defaultRecommendation,
contract)` call. `_buildResult` computes `escalatingChecks =
_escalatingChecks(checks, contract)` and picks `escalationReason` text based
on whether a quality or a disconnect check fired:
`'Signal/optical quality degraded — technician recommended'` vs
`'Offline/disconnected — technician recommended (contract has
escalate_on_disconnect enabled)'`.

**Passing the SAME contract forward to the reply builder, not re-fetching:**
`_buildResult`'s return object carries an extra, undocumented-in-the-public-
DiagnosticResult-shape field `escalationContract: contract || null` purely so
`_buildCustomerReply`'s escalate branch can call
`_escalatingChecks(checks, result.escalationContract)` — i.e. re-derive the
exact same escalating-check set for the "names which check(s) triggered
escalation" reply copy without a second DB round trip. `_storeRun` (the
`ai_diagnostic_runs` INSERT) is unaffected — it destructures only the 6
official fields off `result`, ignores the extra one.

**No contract resolved** (no active contract on file, or the lookup throws) →
`contract` is `null` → `_escalatingChecks(checks, null)` falls through to
exactly `QUALITY_ESCALATE` only — bit-for-bit identical to the pre-387
hardcoded behavior. Verified empirically: all 19 pre-existing tests in
`tests/diagnosticEngineService.test.js` passed unchanged after adding contract
support to the test file's SQL-dispatch mocks (their `escalationContractRow`
param defaults to `null`, so the new `SELECT escalation_enabled, ...` query —
matched in the mocks by the column-name substring `/escalation_enabled/i`,
robust to aliasing — falls through to the default empty-rows branch in every
pre-existing test).

## account_suspension / disconnect_frequency deliberately excluded from BOTH tiers

Not in `QUALITY_ESCALATE`, not in `DISCONNECT_ESCALATE`, not addable via
either contract flag — `account_suspension` is a billing hold (routes to
payment, not a truck roll) and `disconnect_frequency` is
`_diagDisconnects`'s noisy pattern-based heuristic. This is unchanged from
the pre-387 rule; the two contract toggles don't reopen that decision.

## Frontend

Two checkboxes added to `EditContractModal` in
`frontend/src/pages/ContractList.tsx` (the "✏️ Edit" action's modal, title
`📝 Edit Contract #{id}`) — no separate contract-detail settings page exists,
this modal is where every other contract-level flag (`facturar`, `status`,
etc.) already lives. Default-ON handling for `escalation_enabled` when the
API value is `null`/undefined (`contract.escalation_enabled == null ? true :
!!contract.escalation_enabled`) — matters for contracts created before this
migration whose row may be backfilled by the DB default but whose in-flight
`Contract` TS type still allows `null`. i18n keys under
`contractList.editModal.*` in en/es/pt-BR — this modal was already a mix of
translated (`t('contractList.*')`) and untranslated hardcoded-English labels
predating this PR; only the two new fields were i18n'd, the pre-existing
untranslated ones were left as-is (out of scope, not touched).

## Tests

- `tests/diagnosticEngineService.test.js`: 19 → 24. Added an
  `escalationContractRow` param to all 4 SQL-dispatch mock factories
  (`makeDbMock`, `makeNoInternetFiberDbMock`, `makeSlowWirelessDbMock`,
  `makeNoInternetWirelessDbMock`), matched via `/escalation_enabled/i` on the
  SQL text. 5 new tests: (a) `escalation_enabled=0` suppresses even a quality
  `onu_signal error`; (b) explicit `escalate_on_disconnect=0` + `onu_status
  error` → no escalate (contract ON FILE, not just "none resolved" — distinct
  from the pre-existing null-contract test); (c) `escalate_on_disconnect=1` +
  `onu_status error` → escalate true, disconnect-tier reason text, reply
  names the ONU status check; (d) quality escalation still fires with an
  explicit `{enabled:1, disconnect:0}` contract row present, not just when no
  contract resolves; (e) no active contract → defaults, both the quality-still-
  escalates and disconnect-still-doesn't-escalate halves.
- `tests/coreRoutes.test.js`: new test in the existing `PATCH
  /api/contracts/:id` describe block — `escalation_enabled`/
  `escalate_on_disconnect` round-trip through the generic PATCH handler
  (3-call `db.query` mock chain: findByIdOrFail → UPDATE → findById, same
  shape as the existing "unrelated field update" test) and appear in the
  `UPDATE` SQL's SET clause + bound params.
- `frontend/src/pages/__tests__/ContractList.test.tsx`: 2 new tests in a
  `describe('Edit Contract modal — escalation toggles (migration 387)')` —
  default-ON/OFF rendering + togglability, and respecting an explicit
  `escalation_enabled: false` fixture. Uses `getByLabelText` (the checkboxes
  are wrapped by their `<label>`, an implicit a11y association testing-library
  resolves natively).

Full-suite re-run at Finalize (this extension): backend 291/292 suites (1
pre-existing skip), 5994/6018 tests (24 pre-existing skips) — +6 over the
base fix's 5988. Frontend: 114/114 suites, 717/717 tests. `sql:check`,
`spec:check`, `schema:parity` (offline), and frontend `tsc --noEmit` +
`i18n:check` all clean.
