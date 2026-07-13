---
name: service-order-hardening-pr384
description: Migration 384 PR — SO-number race fix, contract client_id org-verify (JSON + CSV), suspension_logs audit wiring on generic PUT/PATCH, bulk-email RBAC fix. Read before touching lifecycleService.nextOrderNumber, contracts.js updateContractHandler, suspensionService.js, or bulk.js /email.
metadata:
  type: project
---

Branch `fix/service-order-hardening`, commit ca23ec9 (2026-07-13). Four
independent hardening fixes bundled into one PR per orchestrator triage,
built from four pre-written verified fix specs. All four gates
(`pnpm test` full suite, `pnpm lint`, `pnpm run sql:check`,
`pnpm run spec:check`, `pnpm run schema:parity`) green; 5808 backend tests
passing.

**1. SO-number race (migration 384).** `lifecycleService.generateOrderNumber`
was renamed to `nextOrderNumber(conn, orgId)` and rewritten to the exact
`nextInvoiceNumber` two-statement pattern (`INSERT IGNORE` + bare `UPDATE ...
LAST_INSERT_ID(next_number)+1` — see [[mysql-atomic-sequence-idiom]]),
backed by new table `organization_order_sequences`. No deprecated alias —
the only caller (`routes/serviceOrders.js`) was updated in the same commit.

**2. Contract client_id org-verify.** `routes/contracts.js` POST '/' and
`updateContractHandler` (shared by PUT/PATCH) now both call
`Client.findById(id, req.orgId)` and throw `ValidationError` on a miss —
mirrors `serviceOrders.js#assertServiceOrderFks` (PR #388). Same guard added
to `importController.js#insertContractRow` (CSV import), which previously
verified NEITHER client_id NOR plan_id — now verifies both, before opening
the transaction, returning `{ error }` per row (never throwing past the
CSV loop).

**3. Suspension audit-log wiring.** Extracted `suspensionService.
logSuspensionEvent(exec, opts)` and `closeOpenSuspensionAndGetStart(exec,
contractId)`, replacing three copy-pasted `INSERT INTO suspension_logs`
statements (suspendContract/reconnectContract/softSuspendContract). Wired
into `contracts.js updateContractHandler`'s suspended/active branches (CoA
now awaited, not fire-and-forget, so its outcome can be logged); terminal
branch (terminated/cancelled/expired) stays log-free by design — no such
ENUM value exists. See [[shared-sql-helper-bound-exec-pattern]] for the
non-obvious `exec` parameter shape this required.

**4. Bulk email RBAC.** `POST /bulk/email` swapped from `clients.view`
(read, nearly org-wide) to `campaigns.create` (write, already correctly
scoped to admin/support/billing via migration 199). One-line fix, no
migration.

**Explicitly excluded from this PR (flagged, not built):**
- CSV credential import (caller-supplied PPPoE username/password) — new
  feature, not a bug; `provisionNewContract` has zero support for it today.
- Bulk-email rate limiting / per-org daily cap — the handler is a synchronous
  `eventBus.emit` per recipient with no queue despite a comment implying one
  exists; a `campaigns.create` holder can still blast up to 1000 recipients
  per call. Separate hardening task.

**Deviation from the verified specs:** the org-number spec (written before
the orchestrator assigned migration numbers) used migration/table-comment
number 382; the brief fixed the actual number at 384 since 382/383 belong
to sibling PRs developed in parallel in other worktrees. All prose/comments
use 384. In this worktree, migrations 382/383 don't exist, so the CI
sequential-numbering check and the README-migration-count check will both
fail here — solely because of that gap, not a real defect; confirmed via
`ls database/migrations/*.sql | wc -l` (382 files present, one short of the
384 the README now claims) before concluding this. Resolves once this PR is
rebased/merged after the sibling PRs land. The README **table-count**
check (326) is independent of migration numbering and passes clean.
