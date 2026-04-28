// lint-staged configuration for FireISP 5.0
// Runs automatically on every `git commit` via the .husky/pre-commit hook.
//
// Backend (.js files under src/):
//   - ESLint with --fix so trivial style issues are auto-corrected before the
//     commit lands.  If ESLint exits non-zero the commit is aborted.
//
// Frontend (.ts/.tsx files under frontend/src/):
//   - Regenerate the OpenAPI schema types (openapi-typescript) so that the
//     type-checker always sees an up-to-date schema.d.ts even when only
//     frontend source files were staged.
//   - tsc --noEmit over the whole project (lint-staged passes no individual
//     files to tsc because tsc ignores extra positional arguments in project
//     mode; returning a function suppresses that file-appending behaviour).
//
'use strict';

module.exports = {
  'src/**/*.js': 'eslint --fix',
  'frontend/src/**/*.{ts,tsx}': () =>
    'pnpm --dir frontend run gen:api && pnpm --dir frontend exec tsc --noEmit',
};
