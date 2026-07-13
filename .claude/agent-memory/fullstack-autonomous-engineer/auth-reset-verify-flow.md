---
name: auth-reset-verify-flow
description: Migration 382 added the users columns password-reset/email-verify needed; email sending, resend endpoint, and 3 frontend pages wired up in the same PR; emailTemplates.js escaping moved to src/utils/htmlEscape.js (own module, not middleware/sanitize.js) and extended to all 8 templates; next migration is 383
metadata:
  type: project
---

Password reset and email verification were dead end-to-end before this PR: `users` was
missing `reset_token_hash`/`reset_token_expires`/`email_verify_token_hash`/`email_verified_at`
(every real call 500'd), nothing ever called the existing `passwordResetEmail`/
`emailVerificationEmail` templates, `generateEmailVerificationToken` had zero callers, and
there was no frontend page/route/link for any of it. Fixed in branch
`fix/auth-reset-email-verify` (3 commits): migration 382 + rollback, email wiring, frontend
pages. Next migration number: **383**.

## Where the email-sending code lives (deliberately asymmetric)

- `POST /auth/password-reset/request` sends the reset email at the **route layer**
  (`src/routes/auth.js`), mirroring `invoices.js`'s inline `require('../services/emailTransport')`
  pattern — the anti-enumeration branch (`authService.requestPasswordReset` returns just
  `{message}` with no `token` when the user isn't found) stays in the service; the route
  guards `if (result.token)` before ever touching email, and the HTTP response is identical
  regardless of send success/failure (failures are `logger.warn`/`logger.error` only).
- `register()`'s verification-token generation + send lives in the **service layer**
  (`src/services/authService.js`), not the route — same best-effort try/catch-and-log
  pattern, just one layer down. There's no anti-enumeration concern for a brand-new account,
  so there was no reason to keep it in the route.
- `resendVerificationEmail(userId)` (new) is entirely service-layer: no-op fast path when
  `user.email_verified_at` is already set, otherwise generates a fresh token and sends.
  Wired to `POST /auth/verify-email/resend`, `authenticate`-only (no RBAC permission, same
  self-service pattern as `/change-password` — no new permission slug needed).

**Why this matters if you touch these routes again:** don't "fix" the inconsistency by moving
password-reset's send into the service — the anti-enumeration HTTP-response guarantee is
easiest to reason about when the route owns "does the response leak anything" and the service
owns "does the token exist."

## HTML-escaping in email templates

`src/views/emailTemplates.js` escapes every DB-free-text value it interpolates
(`userName` in `passwordResetEmail`/`emailVerificationEmail`; `clientName`/`orgName` in all
six other templates; plus per-template free text — invoice line-item `description`,
`paymentReceiptEmail`'s `reference`, `outageNotificationEmail`'s `outageTitle`/`affectedArea`)
via `src/utils/htmlEscape.js` — **not** `middleware/sanitize.js`. That middleware is deleted by
a sibling PR (input-escaping → output-encoding-at-sinks migration); the original version of
this work imported `escapeHtml` from it, which would have crashed the server at require time
once both PRs merged. `htmlEscape.js` is a small standalone module (same 5-entity encoding),
styled like `userSanitize.js`. **Nothing on this branch imports from `middleware/sanitize.js`.**
Left deliberately un-escaped: amounts/dates/currency codes/numeric IDs/URLs (server-formatted
or config-built, not free text) and `severity`/`paymentMethod` (DB ENUM columns — closed
vocabulary, not free text). Subject lines are never escaped anywhere — they're plain text
headers, not HTML, so escaping would show literal `&amp;` etc. to the recipient.

## Rate limiting

`passwordResetLimiter` (RATE_LIMIT_PASSWORD_RESET, default 5/window) is a **new, separate**
limiter mounted only on `/password-reset/request`, stacked on top of the pre-existing
`authLimiter` (20/window) that already covered it by prefix via app.js's
`for (const sub of ['/login','/register','/password-reset',...])` loop (established by PR
#377/session-hardening). The investigation spec this PR was built from claimed "no rate
limiting on any auth.js route" — that was **already stale** relative to `authLimiter`'s
prefix coverage by the time of implementation; always verify current `app.js` before trusting
an investigation doc's rate-limit claims.

## Frontend networking convention for the auth-bootstrap route family

`ForgotPassword.tsx`/`ResetPassword.tsx`/`VerifyEmail.tsx` use raw `fetch()`, matching
`AuthContext.tsx`'s `login()`/`register()` — **not** the typed `api` client from
`@/api/client`. Reason: `api`'s `refreshMiddleware` fires a silent `/auth/refresh` attempt on
**any** 401, including a legitimate "invalid/expired token" 401 from `resetPassword`/
`verifyEmail` — functionally harmless (still returns the original 401) but wasteful and
semantically wrong for a pre-auth flow. All `/auth/login`, `/auth/register`, `/auth/refresh`,
`/auth/verify-email`, `/auth/password-reset`, `/auth/password-reset/request` paths are
CSRF-exempt (`src/middleware/csrf.js`'s `CSRF_EXEMPT_SUFFIXES`) for the same reason, so no
`X-CSRF-Token` header is needed either.

## config.appUrl

Already existed (`process.env.APP_URL`, default `http://localhost:3000`) and is the
established convention for building absolute SPA URLs the browser follows directly (SSO
callback, `/pay/:token` checkout links) — reused as-is for `${config.appUrl}/reset-password?token=...`
and `${config.appUrl}/verify-email?token=...`. No new config key was needed; only
`RATE_LIMIT_PASSWORD_RESET` was new (see above).

## Subscriber portal has NO password-reset/forgot mechanism at all

Confirmed by investigation (`src/routes/portal.js`, `src/services/portalAuthService.js`):
the portal's `PUT /portal/auth/password` requires the **current** password — there is no
forgot-password token flow, no `clients.reset_token_hash`-equivalent column, nothing. A
subscriber who forgets their portal password has no self-service recovery path; only a
staff member manually resetting it works today. Out of scope for this PR (separate
auth stack, `clients.portal_password_hash` not `users`) — flagged, not built.
