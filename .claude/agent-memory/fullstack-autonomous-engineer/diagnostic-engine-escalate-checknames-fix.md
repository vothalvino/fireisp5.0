---
name: diagnostic-engine-escalate-checknames-fix
description: Verified which diagnosticEngineService.js check names actually emit status:'error' and from which handler — canonical reference for ESCALATE_WHEN and any future escalate-rule tuning
metadata:
  type: project
---

**SUPERSEDED (escalate-SET column only):** see
[[diagnostic-engine-escalate-quality-only]] for the current binding rule —
`onu_status` and `cpe_status` (offline states) no longer escalate; only
`onu_signal` (error) and `cpe_signal` (warning|error) do. The
**handler ground-truth table below is still accurate** for which check name
emits which status from which function — only the "escalates?" column is
stale for those two rows.

`src/services/diagnosticEngineService.js`'s `_buildResult` escalate rule was
fixed (branch `feat/escalate-trigger-upload-limiter`) from a dead condition
(`olt_hardware`/`onu_replacement`/`fiber_splice` — never real — plus a
compound `onu_signal && onu_status` AND that can never be true since the two
names come from mutually-exclusive handlers `_diagSlowFiber` vs
`_diagNoInternetFiber`, and `runDiagnostic` dispatches to exactly one handler
per call) to a named `ESCALATABLE_CHECK_NAMES` constant.

**Verified-against-handler ground truth** (re-check this table, not intuition,
if the escalate set is ever revisited — [[diag-engine-blindness-client-id-fix]]
has more context on the handler internals):

| check name | emits 'error'? | handler | escalates? |
|---|---|---|---|
| `onu_signal` | yes, `rx_power_dbm <= -27` | `_diagSlowFiber` | YES |
| `onu_status` | yes, `onu_state !== 'online'` | `_diagNoInternetFiber` | YES |
| `cpe_status` | yes, `cpe.status !== 'active'` | `_diagNoInternetWireless` | YES |
| `pppoe_session` | yes, no session | `_diagNoInternetFiber` | no (reboot-fixable) |
| `radius_session` | yes, no session | `_diagNoInternetWireless` | no (reboot-fixable) |
| `account_suspension` | yes, suspended | both `_diagNoInternet*` | no (billing, not dispatch) |
| `disconnect_frequency` | yes, >10/7d | `_diagDisconnects` | no by default (noisy heuristic — first candidate to add) |
| `olt_hardware` | NEVER — hardcoded 'unknown' | `_diagNoInternetFiber` | n/a, dead |
| `fiber_splice` | NEVER — hardcoded 'unknown' | `_diagNoInternetFiber` | n/a, dead |
| `onu_replacement` | NEVER emitted anywhere in the file | — | n/a, dead |

**How to apply:** Any future change to `_diagSlowFiber`/`_diagNoInternetFiber`/
`_diagNoInternetWireless`/`_diagDisconnects` that adds a new check or changes
an existing one's status logic should re-verify this table before touching
`ESCALATABLE_CHECK_NAMES` — don't assume a check name "sounds" escalatable;
confirm it's actually wired to `status: 'error'` in the handler and that the
handler is actually reachable (not dead code) via `runDiagnostic`'s
symptom/accessType dispatch (lines ~193-208).

See also [[support-escalate-duplicate-ticket-bug]] — a separate, pre-existing
bug found while verifying this fix composes safely with PR #400's
`escalate()` wiring. Initially flagged as an out-of-scope follow-up, then
fixed in the same PR once it was clear this fix is exactly what makes the
latent bug live — first as a SELECT-then-UPDATE guard (commit `e273885`),
then hardened into an atomic conditional-claim UPDATE after review found the
guard had a concurrency gap and a permanent-repair-dead-end gap (commit
`a631fc4`, same branch).
