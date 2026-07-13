---
name: ratelimit-shared-budget-multiroute
description: A single rateLimit.js limiter const mounted on multiple routes shares ONE per-IP budget across all of them (express-rate-limit's default store keys by IP only, not by route) — confirmed empirically, not just from the existing code comments
metadata:
  type: feedback
---

When the same limiter instance from `src/middleware/rateLimit.js` (e.g.
`uploadLimiter`) is mounted on several routes via `router.post(path,
uploadLimiter, ...)`, express-rate-limit's default in-memory store keys
purely by IP — there is no per-route dimension. A request against ANY of
those routes consumes the SAME shared per-IP counter as the others.

Confirmed empirically while testing `uploadLimiter` on the 5
`/import/*/upload` routes: a test asserting "route A gets 1 free request,
THEN route B/C/D/E also each get 1 free request" failed — the 2nd request
against ANY of the 5 routes (regardless of which one) was already 429'd,
because route A's request had consumed the one shared token.

This matches the *documented* rationale elsewhere in `rateLimit.js` for why
`bulkEmailLimiter`/`verifyEmailResendLimiter`/`portalPasswordResetLimiter`
are each a SEPARATE `makeLimiter(...)` instance rather than a shared
reference — but that pattern is for routes gating *semantically different*
actions that must not drain each other's budget. For `uploadLimiter` on the
5 CSV-upload routes, a single shared budget across the group is actually the
*correct* design (they're all the same class of action — hammering the CSV
parser/DB — so a combined cap is what you want), not a bug.

**How to apply:** Before writing a "does each route enforce N/window
independently" test for any limiter mounted on 2+ routes, check whether it's
the SAME instance (shared budget, test accordingly — one exhausted request
anywhere in the group blocks the rest) or deliberately SEPARATE instances
(per-route budget, as with the auth-adjacent limiters above). Don't assume
per-route budgets by default.
