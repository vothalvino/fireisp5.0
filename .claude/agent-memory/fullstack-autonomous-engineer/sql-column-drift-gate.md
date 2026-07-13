---
name: sql-column-drift-gate
description: src/scripts/sql-column-check.js statically validates every INSERT/UPDATE/SELECT column + ENUM literal + table existence against schema.sql; it is a CI gate and it found ~50 always-broken statements across two passes
metadata:
  type: project
---

`src/scripts/sql-column-check.js` (npm: `pnpm run sql:check`, CI step in `lint-and-test`,
plus `tests/sqlColumnCheck.test.js` so it runs in `pnpm test`) statically checks
`src/**/*.js` against `database/schema.sql` in three ways:
1. **INSERT/UPDATE column lists** — every column exists on its table, and no column
   is `GENERATED ALWAYS AS (...)` (MySQL rejects any explicit value for one —
   `credit_note_items.total` / `quote_items.total` shipped writing it).
2. **ENUM literals** — any statically-visible single-quoted value bound to an ENUM
   column must be one of its values.
3. **SELECT column references and table existence** — bare/qualified identifiers in
   WHERE / SELECT-list / JOIN...ON / ORDER BY, plus every FROM/JOIN target must be a
   real table. This is what caught `suspension_rules.is_enabled` (real: `is_active`)
   — a bug the write-side checks can't see at all, since nothing is written when a
   query just silently matches zero rows forever.

**Why:** the Jest suite mocks the DB entirely, so a misnamed column/table passes every
test and 500s (or silently no-ops) forever in production. Two audit passes found ~50
statements in this state total: the original `suspension_logs` INSERTs (four bogus
columns + action values not in the ENUM — every suspend/reconnect/dunning path), then
~16 more of the same INSERT/UPDATE shape elsewhere, then a SECOND pass after adding
SELECT-checking found ~30 more — entire tables that were never created
(`onu_devices`, `alerts` [real: `alert_events`], `access_points`, `qos_policies`,
`client_billing_summaries`, `payment_references`, `wireless_devices`,
`organization_settings`, `olt_pon_ports` [real: `olt_ports`], `jobs` [consolidated
into `work_orders` by migration 363]) concentrated in the §21 AI support/diagnostic
modules (`diagnosticEngineService.js`, `nocAiService.js`, `supportBillingModule.js`,
`supportContextService.js`, `supportGeneralModule.js`) — an entire feature area built
against an imagined schema. Two service methods referenced but never defined
(`radiusService.getSessionByClientId`, `alertService.getActiveAlerts`,
`billingService.getBillingSummary`) were found the same way (adjacent code review,
not the gate itself — it only parses SQL text, not JS method calls) and implemented
for real.

**How to apply:**
- Never widen `KNOWN_SCHEMA_GAPS` casually — it is a ratchet. It holds one real gap:
  `users.reset_token_hash / reset_token_expires / email_verified_at /
  email_verify_token_hash` do not exist anywhere (INSERT/UPDATE *and* SELECT sides
  both listed), so password reset / email verification 500 on every call. Needs a
  migration (follow-up PR) — closing it means deleting the entry.
- `RUNTIME_GUARDED_SELECT_EXCEPTIONS` is a SEPARATE, small list for the opposite
  case: a SELECT that's actually fine because it only runs behind a runtime
  `INFORMATION_SCHEMA.COLUMNS` existence check (optional per-deployment schema).
  Only add an entry after verifying the guard yourself.
- Dynamic SQL (template-interpolated table/column lists, nested subqueries, UNIONs)
  is **skipped and counted, never guessed** — ~111 statements, ~110 SELECT skips.
  Don't "fix" a skip by guessing.
- Parser traps hit and pinned by tests: SQL `-- comments` inside `CREATE TABLE`
  bodies AND inside scanned SELECT literals (both swallow/misread text if not
  stripped — the SELECT-path one shipped as a real bug in the checker itself before
  being caught); regex literals in `${…}` / after `return`; `alias.*` must not be
  read as a bare reference to the alias letter; a SELECT-list alias reused bare in
  `ORDER BY` is legal SQL, not a missing column; `FOR UPDATE` is a locking clause,
  not a column named "update"; the checker's OWN error-message strings can
  accidentally start with "SELECT ... FROM ..." and get self-scanned as fake SQL —
  word error messages to avoid that.
- Its limits: it cannot check values bound as `?` params, NOT-NULL columns omitted
  from an INSERT, `validate()` enums vs column ENUMs, or JS method calls (only SQL
  text). The DDoS route was broken in all three of the first three ways at once.
