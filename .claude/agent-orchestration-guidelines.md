# Agent Orchestration Guidelines
## FireISP — 21-section build, multi-stack (DB / Express backend / OpenAPI / React frontend)

How the **main agent (orchestrator)** and the **`fullstack-autonomous-engineer` subagent (Sonnet)** divide work on this project. This is a reference doc — it is **not** auto-loaded into context (only a root `CLAUDE.md` or memory files would be), so it costs nothing per turn. Read it when picking up the project.

---

## 1. Roles

- **Orchestrator (main agent):** owns the section lifecycle — read the spec section, set up a git worktree, dispatch the subagent, then run the verification **sweep** (the highest-value step), dispatch fixes, confirm CI, open the PR, and after merge do cleanup + memory reconciliation. Handles anything cross-cutting or high-blast-radius directly (advisory/CI infra fixes, schema judgment calls, security-gate decisions) rather than delegating.
- **`fullstack-autonomous-engineer` subagent (Sonnet):** implements a whole section end-to-end (migrations + rollbacks, routes, services, OpenAPI, frontend, tests, README, spec checkboxes) inside the worktree. It is autonomous and carries its own memory; it does not push or open PRs — the orchestrator does that after sweeping.

The orchestrator never trusts the subagent's self-report. Every claim is re-verified against `git diff` and a fresh run of the gates (§3).

---

## 2. Escalation rule (subagent → orchestrator)

The subagent stops and returns the task instead of improvising when:
- a brief's instructions conflict, or a referenced pattern doesn't fit the case;
- the change would touch files outside the scope listed in its brief;
- it hits something needing a cross-section or security-gate decision.

It does **not** silently "fix" things it noticed outside scope — it notes them in its result for the orchestrator.

---

## 3. Section workflow

1. **Spec read** — read the section's items in `isp-platform-features.md`; note cross-section dependencies. Don't start a section whose dependencies are incomplete.
2. **Worktree** — `git worktree add ../fireisp-wt-secN -bN-of-isp-platform-feature.md` off latest `main`; install deps.
3. **Dispatch** — one subagent brief (§4) implementing the whole section in the worktree.
4. **Sweep (orchestrator, mandatory)** — re-verify every claim. Run the gates fresh:
   - `node src/scripts/schema-parity-check.js`; full backend `pnpm test`; `pnpm lint`; `pnpm spec:check`; frontend `gen:api` + `tsc --noEmit` + `pnpm test` + `i18n:check` + `build`; fresh `pnpm install --frozen-lockfile`.
   - **Coverage gate (CI-only — `pnpm test` does NOT enforce it, so a green suite can still fail CI):** `lint-and-test` runs jest a second time and fails if GLOBAL line coverage < 70%. Run it exactly: `pnpm exec jest --coverage --coverageReporters=json-summary >/dev/null 2>&1; node -e "console.log(require('./coverage/coverage-summary.json').total.lines.pct)"` — require ≥70 (aim ≥72 for margin). jest.config also has per-path thresholds for `src/services/` and `src/middleware/` (lines 70, branches 50). New route/service code needs success+422+404+filter/permission tests or coverage sags.
   - DB sweeps: FK-name uniqueness (`grep -oE "CONSTRAINT fk_[a-z0-9_]+" database/schema.sql | sort | uniq -d` → only the 3 tax_rate dups), FK column types BIGINT UNSIGNED, no `IF [NOT] EXISTS` ALTERs, ALTER-added columns backfilled into the schema.sql CREATE TABLE body, no NOT NULL column with ON DELETE SET NULL, no FKs to partitioned `connection_logs`, rollbacks present and not inside `migrations/`.
   - **Seed validation (only CI's real MySQL 8 catches these — schema-parity-check does NOT):** every `INSERT INTO permissions` uses columns `(name, description, module)`; every idempotent seed uses `... FROM DUAL WHERE NOT EXISTS (...)` (a bare `SELECT <cols> WHERE NOT EXISTS` with no FROM is a syntax error); every ENUM column uses a LITERAL in that column's enum (scheduled_tasks.task_type ∈ {auto_suspend,generate_invoice,radius_sync,snmp_poll,usage_rollup,cleanup,notification,backup,maintenance,webhook_retry,other}; priority ∈ {low,normal,high,critical} — never numeric/'system'). Scan: `grep -nE "SELECT .* WHERE NOT EXISTS" database/migrations/<new>*.sql | grep -v "FROM DUAL"` must be empty.
   - **README (CI-gated, BOTH must pass — verify with the exact parse):** migration RANGE — `grep 'Individual numbered migration files' README.md` trailing number == highest migration file number; AND table count — `all NNN tables` == `grep -c "CREATE TABLE" database/schema.sql`.
   - **Half-workflow checks (the recurring failure):** every seeded permission consumed by a route (`requirePermission('<perm>'`), and a seeded `<x>.delete` perm needs a DELETE route; every seeded scheduled task has **a `cron_expression`** (or it never fires) **+ a `taskRunner` case + a dispatch test**; **every created table is read/written by code** (`grep -rln <table> src/`); spec checkboxes actually edited in the file.
   - Mojibake only in the branch diff (`git diff origin/main..HEAD | grep -E "â€|Ã©|ðŸ"`); the repo has pre-existing mojibake in comments — ignore those.
   - These lint-and-test gates run in ORDER under `bash -e` (eslint → spec-drift → audit → jest+coverage → coverage-threshold → README-sync → migration-numbering) and stop at the FIRST failure, so fixing one reveals the next — run them ALL locally, don't push-and-pray. After merge, check **main's push CI** too: the blocking `container-scan` (Trivy) and `pnpm audit` only fail on push-to-main, not on the PR, and a newly-published advisory can turn them red with no code change (handle build/dev-only-dep CVEs with a documented `.trivyignore` / `pnpm.auditConfig.ignoreGhsas` entry).
5. **Fix** — dispatch focused fix tasks (or fix directly) for anything the sweep finds.
6. **PR + CI** — push, open PR to `main`, watch checks. `main` is protected; merge is the user's.
7. **Post-merge** — pull `main`, remove the worktree (`rm -rf` the folder after `git worktree remove` due to Windows file locks), delete merged local branches, and reconcile agent memory (the harness writes subagent memory into the **main checkout** even from a worktree — review it for false/self-serving claims, fold the orchestrator's sweep findings in, and ensure it rides the feature PR; `git checkout -- .claude/agent-memory` to drop leftover working-tree dirt). The VS Code changes area should be empty between sections.

---

## 4. Subagent brief template

```
## Task            [one-sentence goal]
## Section         §N of isp-platform-features.md (list the items)
## Working dir      the worktree path — never the main checkout
## Scope            files it may modify (anything else is out of scope → escalate)
## Hard rules       the DB/backend/frontend/encoding rules that have broken CI before
## Verification     the gates it must pass and report exact numbers for
## Reporting        "orchestrator pushes/PRs afterwards — do not push"; report claims the
                    orchestrator will diff against git
```
Phrase prohibitions as "the orchestrator pushes afterwards," not bare "do not push" — the bg-mode classifier can read bare prohibitions as user-set boundaries and then block the orchestrator's own push/PR.

---

## 5. Integration & quality gates

- **Migrations are sequential** — never run two migration-producing tasks in parallel, even across sections.
- **One error-handling / auth / org-scoping pattern** — defined in the subagent definition; the subagent never invents its own.
- A section is **done** only when: all spec items implemented + checkboxes ticked; the sweep (§3) is clean; CI green on the PR (and the orchestrator has checked **main's post-merge run** too — the blocking container-scan only runs on push to `main`); memory reconciled.

---

## 6. Anti-patterns

- ❌ Trusting the subagent's self-report instead of re-running gates and diffing claims.
- ❌ Shipping half-workflows: seeded perms with no route, seeded tasks with no `taskRunner` case, tables created but never read.
- ❌ Calling branch-introduced failures "pre-existing" without checking against `origin/main`.
- ❌ Subagent editing outside its scope; orchestrator rubber-stamping a section without the sweep.
