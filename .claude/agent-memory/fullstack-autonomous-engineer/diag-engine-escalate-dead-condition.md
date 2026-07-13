---
name: diag-engine-escalate-dead-condition
description: diagnosticEngineService._buildResult's escalate condition can never fire today — no handler emits both onu_signal+onu_status, and olt_hardware/fiber_splice checks are permanently hardcoded 'unknown'. Found while wiring generateSupportResponse's escalate:true -> escalate() call (PR F, branch feat/ai-support-diagnostic-replies).
metadata:
  type: project
---

`_buildResult(checks, defaultRecommendation)` (src/services/diagnosticEngineService.js)
computes `escalate` as:

```js
const escalateNames = new Set(['olt_hardware', 'onu_replacement', 'fiber_splice']);
const escalate = errorChecks.some(c => escalateNames.has(c.name))
  || (errorChecks.some(c => c.name === 'onu_signal') && errorChecks.some(c => c.name === 'onu_status'));
```

**This condition is unreachable through any real `runDiagnostic()` call as of
migration/commit 7111182 (2026-07-13):**

- `olt_hardware` and `fiber_splice` checks are hardcoded
  `status: 'unknown'` unconditionally everywhere they appear (both in
  `_diagNoInternetFiber`) — "not yet implemented" per the file's own
  comments. They can never become `'error'` without new code.
- `onu_replacement` is not a check name emitted anywhere in the file (grep
  confirmed zero occurrences) — a dead/aspirational reference.
- `onu_signal` (emitted only by `_diagSlowFiber`) and `onu_status` (emitted
  only by `_diagNoInternetFiber`) never co-occur in the same `checks` array,
  because `runDiagnostic` dispatches to exactly ONE handler per call based on
  `(symptom, accessType)`. No symptom triggers both handlers at once.

Verified live (not just by inspection): a real `_diagNoInternetFiber` run with
BOTH `pppoe_session:'error'` AND `onu_status:'error'` (the worst realistic
no-internet scenario — no session AND ONU offline) still returns
`escalate:false`, because neither of those two names is in `escalateNames`
and `onu_status` alone doesn't satisfy the AND-combo.

**Practical impact:** `ai_diagnostic_runs.escalate` has always been `0` in
production. This PR (branch `feat/ai-support-diagnostic-replies`, commit
7111182) correctly wires `generateSupportResponse`'s `escalate`/
`escalationReason` output through to `supportConversationService`'s
`_generateResponse` return contract, and both `sendMessage`/
`startConversation` now call the real `escalate()` when `result.escalate` is
true — but the trigger condition upstream in `_buildResult` never actually
fires today, so this new code path is real and correct but **currently
dormant** until `_buildResult`'s escalate rule is fixed in a follow-up.

**Why not fixed in this PR:** deciding what SHOULD trigger escalation (e.g.
should a single 'error' check ever be enough? should error-count thresholds
apply? should `onu_status` alone escalate for `no_internet`?) is a product/
domain judgment call, not a mechanical fix — same category as the
`SWEEP_FOLLOWUP` entries in `sql-column-check.js`'s known-gaps list (see
[[sql-column-drift-gate]]). The PR F spec/brief scoped this PR to
`generateSupportResponse` + the return-contract rewiring + the
`[object Object]` fix; it didn't anchor on `_buildResult` at all (its own
anchors assumed the onu_signal+onu_status combo was reachable — it isn't).

**How to apply:** before claiming "escalate now works end-to-end" in any
future diagnostic-engine work, re-verify this condition is still dead (grep
`escalateNames` and confirm which check names can reach `'error'` status) —
don't assume PR F's wiring alone makes real escalations happen. A sensible
follow-up fix: escalate on 2+ `'error'` checks in a single result regardless
of name (a more defensible general rule than an allowlist of never-reachable
names), or add `onu_status` to a broader "any single physical-layer error on
a no_internet run" rule — needs a product decision, flag to the user first.

See also [[diag-engine-blindness-client-id-fix]] (prior PR, different bugs in
the same file: `conv.client_id` wrapper-unwrap bug, the blind-vs-clean
conflation in `_buildResult`, and `devices.client_id` being unsettable).
