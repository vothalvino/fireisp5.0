---
name: openapi-fetch-never-destructure
description: openapi-fetch POST calls (esp. requestBody?:never operations) type-error on `res.error`/`res.data` dot-access but compile fine when destructured — always destructure
metadata:
  type: feedback
---

When calling `api.POST(path, opts)` from the generated openapi-fetch client and then accessing the result, `const res = await api.POST(...); res.error` can fail `tsc --noEmit` with
`Property 'error' does not exist on type 'never'` — even though the exact same call, destructured, compiles cleanly: `const { data, error: e } = await api.POST(...)`.

Observed on `POST /quotes/{id}/approve` (an operation with `requestBody?: never`, called as `api.POST(path, { params: {...}, body: {} as never })`) and on `POST /quotes` (a normal operation with a real typed body, called as `api.POST('/quotes', { body: body as never })`). Both failed as `const res = ...; res.error` and both passed as `const { data, error: e } = ...`.

**Why:** the codebase's own working call sites (`ServiceOrderList.tsx` `/service-orders/{id}/start` and `/cancel`, `LeadList.tsx` `/leads/{id}/convert`, `ClientProfileTabs.tsx` `/clients/{id}/geocode`) all destructure directly from the awaited call rather than binding it to a variable first. Overload resolution across openapi-fetch's `PathsWithMethod` union apparently collapses to `never` for dot-access on some paths/shapes but destructuring pattern-binds cleanly regardless.

**How to apply:** always write `const { data, error } = await api.POST(...)` (or GET/PUT/PATCH/DELETE) — never `const res = await api.POST(...); res.error`. If a pre-existing file already uses the `const res = ...` form and it compiles, leave it; but for new code, destructure. This is not about `body: {} as never` specifically — it reproduced on a normal typed-body call too.
