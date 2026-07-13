---
name: sql-column-drift-gate
description: src/scripts/sql-column-check.js statically validates every INSERT/UPDATE/SELECT column + ENUM literal + table existence against schema.sql; it is a CI gate; the SELECT-checking sweep's fixes were reverted out of PR #390 after adversarial review found silent-wrong-data defects and moved to a follow-up PR
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
against an imagined schema, including guarded calls to service methods referenced
but never defined (`radiusService.getSessionByClientId`, `alertService.getActiveAlerts`,
`billingService.getBillingSummary` — found the same way, by adjacent code review,
since the gate only parses SQL text, not JS method calls; each call site is wrapped
in a `typeof x.fn === 'function'` guard or try/catch, so on `main` today these are
safe no-ops, not crashes).

**The SELECT-sweep got reverted — read this before touching `KNOWN_SCHEMA_GAPS` /
`KNOWN_MISSING_TABLES`.** A second adversarial review of PR #390 found that ~10 of
the ~30 SELECT fixes from the pass above were **silent-wrong-data defects**, not
just "still broken": the statements were previously throwing and being caught by a
`try/catch` into a safe `'unknown'`/empty fallback, and the "fix" turned some of
those safe failures into *confidently wrong* answers — e.g. `kbService.js` picking
ANY tenant's `ai_providers` row with no `organization_id` filter (decrypts and
spends another org's API key on this org's customer text — a cross-tenant leak),
and `serviceHealthService.getRadiusSession` fabricating `online: true` from account
state instead of a live-session check, which then fed a customer-facing LLM prompt.
Lesson: a SELECT fix is not done when it satisfies the gate (columns/tables exist).
The bar is "is this the RIGHT query", which the gate cannot verify — that needs a
human read of what the result is used for. **Response:** every peripheral file the
sweep touched (kbService, serviceHealthService, automationService,
diagnosticEngineService, nocAiService, supportBillingModule, supportContextService,
supportGeneralModule, portal.js, webhookService/webhookSecurity, exportController,
configBackupService, cpeInventoryService, subnetPlannerService, topologyMapService,
reportService, wirelessService, plus `radiusService.getSessionByClientId` and
`alertService.getActiveAlerts`) was reverted to its pre-sweep (`main`) state on
`fix/suspension-logs-column-drift` via `git checkout main -- <file>` (or `git
checkout <phase1-commit> -- <file>` for files — `radiusService.js`, `alertService.js`
— that ALSO carried an unrelated, already-reviewed-clean fix earlier in the same
branch: don't blind-revert a shared file, diff it against each ancestor commit
first). The reviewed-clean core that shipped in PR #390 as-is: the original
`suspension_logs` INSERTs, `radiusService`'s walled-garden INSERT,
`suspensionService.evaluateRules`' `is_active` fix (+ the `SuspensionRule`
model/schema/frontend fillable fixes it exposed), `checkoutService`
(`token_reference` + strict `succeeded`-only `charged` + retry-on-pending),
`CreditNote`/`Quote`'s GENERATED-column fix, and `cfdiDocuments.js`'s cancel route
now delegating to `cfdiService.cancel()` instead of hand-rolling SQL.
`supportConversationService.getOrgProviderId` was ALSO kept (not reverted) — the
reviewer called it out by name as the correct shape to copy when the sweep's
fixes are re-applied for real. The reverted work lives on branch
`backup/full-sweep-13cb3bc` and is being re-applied — each statement re-verified
against "is it right", not just "does it run" — in a separate follow-up PR (§21 SQL
drift sweep).

**How to apply:**
- Never widen `KNOWN_SCHEMA_GAPS` / `KNOWN_MISSING_TABLES` casually — both are a
  ratchet, and an entry can point at TWO different kinds of follow-up: a migration
  (`users.reset_token_hash` et al. — no columns exist anywhere, password reset /
  email verification 500 on every call) or a **code fix pending review**, tagged
  with the shared `SWEEP_FOLLOWUP` why-string — the ~118 entries the reverted
  peripheral sweep left behind. Closing either kind means deleting the entry once
  the real fix lands and is reviewed, never before.
- `KNOWN_MISSING_TABLES` is `KNOWN_SCHEMA_GAPS`'s sibling for a FROM/JOIN target
  that never existed at all (not a column typo — the whole table is imaginary,
  e.g. `onu_devices`, `alerts` real: `alert_events`). Column-level checks against
  those tables are already free no-ops (no `schema.columns` to check against);
  this list only silences the table-existence error itself.
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
  It ALSO cannot tell a query that runs against the right table/columns but the
  WRONG semantics (org-scoping, liveness checks, unknown-vs-ok fallback logic) —
  that class of bug (the whole reason the sweep got reverted) needs a human
  reading what the result is used for, not a sharper parser.
