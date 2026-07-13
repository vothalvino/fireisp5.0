---
name: portal-password-reset
description: Migration 385 added subscriber-portal forgot/reset-password (clients.portal_reset_token_*), mirroring migration 382's staff flow; documents the rateLimit-mock-wholesale gotcha and a reusable rate-limit-isolation test pattern; next migration is 386
metadata:
  type: project
---

Branch `feat/portal-password-reset` (3 commits) closed the gap flagged in
[[auth-reset-verify-flow]]: the subscriber portal had zero self-service
password recovery (`PUT /portal/auth/password` requires the *current*
password). Added `POST /portal/auth/password-reset/request` and
`POST /portal/auth/password-reset` on `clients.portal_reset_token_hash`/
`portal_reset_token_expires` (migration 385), mirroring migration 382's
`users` columns exactly. Next migration number: **386**.

## Anti-enumeration + never-a-self-enablement-path (the interesting part)

`portalAuthService.requestPasswordReset` only mints a token when the matched
client has `portal_password_hash IS NOT NULL AND status <> 'inactive' AND
deleted_at IS NULL`. All three negative cases (unknown email, portal never
enabled, inactive) return the byte-identical `{message}` with no token and no
email — this is a *product* gate, not just anti-enumeration: `clients` uses
`portal_password_hash IS NULL` as a deliberate admin "portal access not
enabled yet" control (see `login()`'s distinct error message for it), so
forgot-password must never become a side-channel that self-activates portal
access for a subscriber the ISP hasn't turned on. If a future feature wants
forgot-password to double as self-activation, that must be an explicit
product decision, not an accidental copy-paste of the staff flow.

## Adding a new rate limiter export breaks every test file that mocks
## `middleware/rateLimit` wholesale

`portalPasswordResetLimiter` is a new named export required by
`src/routes/portal.js`. Any test file that does
`jest.mock('../src/middleware/rateLimit', () => ({ apiLimiter: ..., ... }))`
(a full object literal, not `jest.requireActual` + override) AND also
`require('../src/app')` will throw at route-definition time
(`Route.post() requires a callback function but got a [object Undefined]`)
because the new export resolves to `undefined` in the mock. Had to patch 7
files: `section17.test.js`, `section17DataSecurity.test.js`, `section18.test.js`,
`section18Extended.test.js`, `section18Services.test.js`, `section21.test.js`,
`multitenantIsolation.test.js` — each needed a
`portalPasswordResetLimiter: (_req, _res, next) => next()` line added next to
their existing `verifyEmailResendLimiter` entry. `tests/clientDnd.test.js`
also mocks the module but requires `src/routes/clientDnd` directly (never
loads `portal.js`), so it did NOT need patching — check what a mock-user
actually requires before assuming it needs the new export.
**Lesson: any new named export added to `rateLimit.js` (or any module widely
mocked-wholesale-with-an-object-literal) needs a repo-wide grep for
`jest.mock('../src/middleware/rateLimit'` before you're done, not just the
files you intended to touch.**

## Rate-limit "distinct budget" tests need module-registry isolation

express-rate-limit's default MemoryStore is a property of the limiter
*instance*, and Jest gives each test FILE a fresh module registry — but NOT
each test/describe block within one file. A test that hits a route N times to
exhaust its budget will leave that budget partially consumed for every
later test in the same file that touches the same route, silently changing
how many hits are needed to trip the next 429. Two fixes used here:
1. Put "hit route 5x, expect 429 on 6th" tests in their own dedicated file
   (`tests/portalPasswordResetRateLimit.test.js`) rather than folding them
   into an existing shared file.
2. Within that file, when you need TWO such tests (staff-exhausts-first and
   portal-exhausts-first, to prove the property holds in both directions),
   wrap `jest.resetModules()` + re-`require()` of `db`/`app` in a
   `loadFreshApp()` helper called at the top of each test — this forces a
   fresh `express-rate-limit` module instance (and therefore a zeroed
   counter) per test, not just per file.

## Frontend / i18n

Cloned `ForgotPassword.tsx`/`ResetPassword.tsx` verbatim into
`frontend/src/pages/portal/` with a global find-replace of `/login` →
`/portal/login`, `/forgot-password` → `/portal/forgot-password`,
`/reset-password` → `/portal/reset-password`, and the `forgotPassword.*`/
`resetPassword.*` i18n keys → `portalForgotPassword.*`/`portalResetPassword.*`
(new namespaces, not reused — kept parallel to how `portalLogin.*` is already
separate from `login.*`). `PortalLogin.tsx` didn't import `Link` before this
change — needed adding. Routes are public siblings of `/portal/login` in
App.tsx, outside `<PortalRoute>`.
