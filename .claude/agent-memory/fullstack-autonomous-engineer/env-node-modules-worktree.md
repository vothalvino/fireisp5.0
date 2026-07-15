---
name: env-node-modules-worktree
description: In a git worktree under the main repo, node_modules only exists at the main checkout root — pnpm's bin resolution fails there but npx/node's require() still work via directory walk-up.
metadata:
  type: project
---

Worktrees created under `<main-repo>/.claude/worktrees/<name>/` have NO local
`node_modules` of their own. `pnpm lint` / `pnpm test` (which rely on pnpm's
own `node_modules/.bin/<tool>` resolution scoped to the current package
directory) fail with `sh: 1: eslint: not found` / similar, because pnpm does
not walk up parent directories looking for a bin.

**What still works and why:** `npx eslint ...` and `npx jest ...` (or `node
-e "require(...)"`) succeed anyway, because Node's own `require()` resolution
algorithm walks UP parent directories looking for `node_modules` — and since
the worktree is nested inside the main repo checkout
(`/home/coder/Documents/Claude/fireisp5.0/node_modules` in this environment),
that walk-up finds the main checkout's real, correctly-versioned
`node_modules` (confirmed: `npx eslint --version` → v10.2.1, matching the
`^10.2.0` pin in package.json — it is NOT a different ad-hoc npx-downloaded
version).

**How to apply:** In a worktree, use `npx eslint src/ --ext .js` and
`npx jest --detectOpenHandles --forceExit` (or `npx jest tests/<file>.test.js
--forceExit` for targeted runs) instead of the bare `pnpm lint` / `pnpm test`
scripts — same real dependency versions, just invoked through npx so it
resolves the binary via `require()`-style walk-up. `node -e "require(...)"`
is a fast way to sanity-check a module loads before running the full test
suite. See also [[env-setup]] for the Windows-path variant of this note from
a different machine — both boil down to "verify the toolchain resolves before
trusting a bare `pnpm` script failure as a real code problem."

**`frontend/` needs its OWN node_modules — the walk-up trick doesn't reach
it.** `frontend/` is a separate pnpm workspace package; `npx tsc`/`npx
openapi-typescript` run from inside `frontend/` walk up looking for
`node_modules` and can find the wrong thing (root `node_modules`, which
lacks frontend-only deps) or nothing at all — `tsc --noEmit` then fails with
unrelated-looking errors (`Cannot find type definition file for
'@testing-library/jest-dom'`) or `npx` silently downloads an ad-hoc fresh
copy of the tool instead of using the pinned version. Two more failure
modes worth recognizing as environment noise, not real bugs: (1) the MAIN
checkout's own `frontend/node_modules` can itself be stale (missing a
recently-added dependency like `dompurify` if nobody has run `pnpm install`
there since) — don't assume main checkout is ground truth; (2) `git commit`
invokes husky's pre-commit hook, which runs `pnpm --dir frontend run
gen:api && tsc --noEmit` and `eslint --fix` for real (not via npx) — those
fail outright with `sh: 1: openapi-typescript: not found` if no
`node_modules` is resolvable, and commit does not go through.
**Fix that worked**: find ANY sibling worktree under
`.claude/worktrees/*/` whose `frontend/package.json` and root
`pnpm-lock.yaml` are byte-identical to yours (`diff` both — usually true,
since they all descend from the same recent main) and has a REAL
(non-symlinked) `frontend/node_modules` with the dependency in question
present; symlink both `frontend/node_modules` and root `node_modules` from
that worktree into yours (`ln -s <other>/frontend/node_modules
frontend/node_modules`, same for root `node_modules`) before running
`pnpm run lint`/`tsc --noEmit`/`git commit`. Remove both symlinks
afterward — they're untracked but git still lists them under `??` (a
symlink doesn't match a `node_modules/`-with-trailing-slash gitignore
pattern the same way a real directory does), so leaving them risks an
accidental `git add -A`.
