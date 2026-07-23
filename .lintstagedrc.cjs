// lint-staged configuration for FireISP 5.0
// Runs automatically on every `git commit` via the .husky/pre-commit hook.
//
// Backend (.js files under src/):
//   - ESLint with --fix so trivial style issues are auto-corrected before the
//     commit lands.  If ESLint exits non-zero the commit is aborted.
//
// Frontend: deliberately NOT type-checked here anymore. The old hook ran
// gen:api + a full-project `tsc --noEmit` on every commit that touched a
// frontend file (~15-30s each), duplicating what CI's frontend job enforces
// anyway (`pnpm --filter fireisp-frontend run lint` = gen:api && tsc). Local
// commits stay fast; type errors are still a hard CI failure — run
// `pnpm --dir frontend run lint` manually before pushing if you want the
// early signal.
//
'use strict';

module.exports = {
  'src/**/*.js': 'eslint --fix',
};
