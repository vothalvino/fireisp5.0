---
name: diagnostic-engine-escalate-quality-only
description: Binding product decision — diagnosticEngineService auto-escalation fires ONLY on RF/optical signal-quality checks (onu_signal error, cpe_signal warning|error), never on offline/disconnect/session/account checks. Supersedes the escalate SET (not the handler ground-truth table) in diagnostic-engine-escalate-checknames-fix.md.
metadata:
  type: project
---

Branch `fix/escalate-quality-only` (commit `bdaf466`) replaced the
`ESCALATABLE_CHECK_NAMES` set (`onu_signal`, `onu_status`, `cpe_status`) in
`src/services/diagnosticEngineService.js` with a per-`(check, status)` map:

```js
const ESCALATE_WHEN = {
  onu_signal: ['error'],
  cpe_signal: ['warning', 'error'],
};
function _escalatingChecks(checks) {
  return checks.filter(c => (ESCALATE_WHEN[c.name] || []).includes(c.status));
}
```

**Why (binding, from the ISP owner, not a technical judgment call):** this
service area has frequent grid power outages and customers rarely run a UPS.
An offline/disconnected ONU or CPE, a dropped PPPoE/RADIUS session, or a
suspended account are NORMAL day-to-day states there — auto-dispatching a
technician (what `escalate:true` actually does, via
`supportConversationService.escalate`) for any of them is wrong. Only a
*measured* signal/optical quality fault the customer cannot fix by
power-cycling anything should truck-roll a tech: bad fiber RX power
(`onu_signal` — rx_power_dbm <= -27, emits `'error'`) or low wireless signal
(`cpe_signal` — signal_dbm <= -75, emits `'warning'`, NOT `'error'` — see
`_diagSlowWireless`). **`onu_status` and `cpe_status` (offline states) no
longer escalate** — this reverses the prior fix's ground-truth table's
`escalates? YES` column for those two rows; the table's *handler* facts
(which check emits which status from which function) are still accurate, only
the escalate-worthiness column is stale for those two names. See
[[diagnostic-engine-escalate-checknames-fix]] for the still-valid handler
ground truth.

**How to apply:** any future change to which checks trigger escalation must
edit `ESCALATE_WHEN` (single source of truth) and get sign-off — do not add
`onu_status`/`cpe_status`/`pppoe_session`/`radius_session`/`dhcp_session`/
`account_suspension`/`disconnect_frequency` back without a new, explicit
product decision overriding this one.

## cpe_signal's status is 'warning', not 'error' — a real gotcha

`_diagSlowWireless`'s low-signal check emits `status: 'warning'` for
`signal_dbm <= -75` (see line ~387-390) — there is no threshold in that
handler that ever emits `'error'` for `cpe_signal`. `ESCALATE_WHEN` matches on
`'warning'` for exactly this reason. Any code that assumes "escalate ⟺ some
check is `'error'`" is now wrong — `_buildResult`'s `errorChecks` variable
(used for the `cause` field's "Issues detected: ..." text) and the escalate
computation are now two independently-filtered things, not the same set
filtered twice.

## Customer-reply naming bug this also fixed

`_buildCustomerReply`'s escalate branch used to name
`_labelChecks(errorChecks.length ? errorChecks : checks)` — when escalation
was driven by a `'warning'`-status check (any future one, and now
`cpe_signal`), `errorChecks` is empty, so the `: checks` fallback would dump
**every** check into the sentence, including unrelated `'unknown'` ones (e.g.
`ap_load`, `quota_status`). Fixed to
`_labelChecks(_escalatingChecks(checks))` — names exactly the check(s) that
triggered escalation, regardless of whether they're `'error'` or `'warning'`.
`escalationReason` changed from `'Physical infrastructure issue detected —
technician required'` to `'Signal/optical quality degraded — technician
recommended'` to match.

## Flagged, not fixed — wireless "capacity" escalation

The ISP owner raised wireless "capacity" alongside signal quality as a
possible escalation trigger. Not implemented: `ap_load` is unimplemented
(always `'unknown'`, see `_diagSlowWireless`), and `channel_interference` is
computed **org-wide** via `wirelessService.getInterferenceReport(orgId)`, not
per client — escalating on it would truck-roll every wireless customer in the
org simultaneously off a single interference event. A code comment at
`ESCALATE_WHEN`'s definition flags this as "pending ap_load telemetry — not
escalatable today." Needs real per-client AP-load telemetry (and probably a
per-AP, not per-org, interference signal) before this can be added.

## Tests

`tests/diagnosticEngineService.test.js` (19 tests, up from 12) — added
`makeSlowWirelessDbMock` / `makeNoInternetWirelessDbMock` SQL-dispatch mock
helpers (mirroring the existing fiber ones) to drive `_diagSlowWireless` /
`_diagNoInternetWireless` for real rather than stubbing
`generateSupportResponse`'s internals. Table covered: `onu_signal` error →
escalate true; `cpe_signal` warning → escalate true, reply names only the
degraded check (regression guard for the naming bug above, asserts labels for
`ap_load`/`quota_status`/`channel_interference`/`radius_session` do NOT
appear); `onu_status` error (offline) → escalate false; `cpe_status` error
(offline) → escalate false; `pppoe_session` error → escalate false (already
correct pre-change, kept). Full backend suite re-run at Finalize: 291/292
suites passed (1 pre-existing skip, see [[testing-conventions]]), 5988/6012
tests passed (24 pre-existing skips) — no regressions elsewhere.
