# Agent Orchestration Guidelines
## FireISP — 21-section build, multi-stack (DB / Express backend / OpenAPI / React frontend)

How the **main agent (orchestrator)** and the **`fullstack-autonomous-engineer` subagent (Sonnet)** divide work on this project. This is a reference doc — it is **not** auto-loaded into context (only a root `CLAUDE.md` or memory files would be), so it costs nothing per turn. Read it when picking up the project.

> **No `CONVENTIONS.md` system.** Earlier drafts prescribed a single `CONVENTIONS.md` (and later a `conventions/` core+appendix tree) attached to every brief. That was never built and is deliberately **not** adopted — it would duplicate the mechanisms below and bloat context. Conventions live where they already are (see §2).

---

## 1. Roles

- **Orchestrator (main agent):** owns the section lifecycle — read the spec section, set up a git worktree, dispatch the subagent, then run the verification **sweep** (the highest-value step), dispatch fixes, confirm CI, open the PR, and after merge do cleanup + memory reconciliation. Handles anything cross-cutting or high-blast-radius directly (advisory/CI infra fixes, schema judgment calls, security-gate decisions) rather than delegating.
- **`fullstack-autonomous-engineer` subagent (Sonnet):** implements a whole section end-to-end (migrations + rollbacks, routes, services, OpenAPI, frontend, tests, README, spec checkboxes) inside the worktree. It is autonomous and carries its own memory; it does not push or open PRs — the orchestrator does that after sweeping.

The orchestrator never trusts the subagent's self-report. Every claim is re-verified against `git diff` and a fresh run of the gates (§4).

---

## 2. Where conventions actually live (no central file)

| Kind of convention | Source of truth |
|---|---|
| Stack, auth, org-scoping, code style, commit format | `.claude/agents/fullstack-autonomous-engineer.md` (the subagent definition) |
| Testing patterns, mocks, known-failure notes | `.claude/agent-memory/fullstack-autonomous-engineer/testing-conventions.md` |
| API/OpenAPI pattern, lint rules, env setup | `openapi-pattern.md`, `regex-escape-lint.md`, `env-setup.md` (same memory dir) |
| Per-section decisions, tables, constraints, "next migration" | `section{N}-*.md` (same memory dir), indexed by `MEMORY.md` |
| DB/table/migration/endpoint counts | `README.md` + the section memory files |
| Orchestration gotchas, CI advisory pitfalls, deployment model | the orchestrator's own session memory |

Only the orchestrator writes these. The subagent treats them as read-only; on conflict it escalates (§3). Update the relevant file in the **same** change that introduces a new pattern/decision — never let it lag.

---

## 3. Escalation rule (subagent → orchestrator)

The subagent stops and returns the task instead of improvising when:
- a brief's instructions conflict, or a referenced pattern doesn't fit the case;
- the change would touch files outside the scope listed in its brief;
- it hits something needing a cross-section or security-gate decision.

It does **not** silently "fix" things it noticed outside scope — it notes them in its result for the orchestrator.

---

## 4. Section workflow

1. **Spec read** — read the section's items in `isp-platform-features.md`; note cross-section dependencies. Don't start a section whose dependencies are incomplete.
2. **Worktree** — `git worktree add ../fireisp-wt-secN -bN-of-isp-platform-feature.md` off latest `main`; install deps.
3. **Dispatch** — one subagent brief (§5) implementing the whole section in the worktree.
4. **Sweep (orchestrator, mandatory)** — re-verify every claim. Run the gates fresh:
   - `node src/scripts/schema-parity-check.js`; full backend `pnpm test`; `pnpm lint`; `pnpm spec:check`; frontend `gen:api` + `tsc --noEmit` + `pnpm test` + `i18n:check` + `build`; fresh `pnpm install --frozen-lockfile`.
   - DB sweeps: FK-name uniqueness, FK column types BIGINT UNSIGNED, no `IF [NOT] EXISTS` ALTERs, permissions INSERT columns `(name, description, module)`, rollbacks present and not inside `migrations/`, README counts == `grep -c "CREATE TABLE"`.
   - **Half-workflow checks (the recurring failure):** every seeded permission consumed by a route; every seeded scheduled task has a `taskRunner` case + test; **every created table is read/written by code** (`grep -rln <table> src/`); spec checkboxes actually edited in the file.
   - Mojibake only in the branch diff (`git diff origin/main..HEAD | grep -E "â€|Ã©|ðŸ"`); the repo has pre-existing mojibake in comments — ignore those.
5. **Fix** — dispatch focused fix tasks (or fix directly) for anything the sweep finds.
6. **PR + CI** — push, open PR to `main`, watch checks. `main` is protected; merge is the user's.
7. **Post-merge** — pull `main`, remove the worktree (`rm -rf` the folder after `git worktree remove` due to Windows file locks), delete merged local branches, and reconcile agent memory (the harness writes subagent memory into the **main checkout** even from a worktree — review it for false/self-serving claims, fold the orchestrator's sweep findings in, and ensure it rides the feature PR; `git checkout -- .claude/agent-memory` to drop leftover working-tree dirt). The VS Code changes area should be empty between sections.

---

## 5. Subagent brief template

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

## 6. Integration & quality gates

- **Migrations are sequential** — never run two migration-producing tasks in parallel, even across sections.
- **One error-handling / auth / org-scoping pattern** — defined in the agent def; the subagent never invents its own.
- A section is **done** only when: all spec items implemented + checkboxes ticked; the sweep (§4) is clean; CI green on the PR (and the orchestrator has checked **main's post-merge run** too — the blocking container-scan only runs on push to `main`); memory reconciled.

---

## 7. Anti-patterns

- ❌ Trusting the subagent's self-report instead of re-running gates and diffing claims.
- ❌ Shipping half-workflows: seeded perms with no route, seeded tasks with no `taskRunner` case, tables created but never read.
- ❌ Calling branch-introduced failures "pre-existing" without checking against `origin/main`.
- ❌ Subagent editing outside its scope; orchestrator rubber-stamping a section without the sweep.
- ❌ Re-introducing a central `CONVENTIONS.md`/`conventions/` system — keep conventions in the files in §2.
