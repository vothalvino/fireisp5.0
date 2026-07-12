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
