---
name: patch-diff-explicit-clear-vs-omit
description: A PATCH-diff helper using `value.trim() || undefined` for a changed optional string field silently drops the field entirely (via JSON.stringify) when the user explicitly clears it — the backend then treats the omission as "unchanged" and keeps the old value. Send `null` explicitly for a real clear when the column is nullable and validate() skips null.
metadata:
  type: feedback
---

Found as a minor review finding in `UserList.tsx`'s Edit User modal
(`frontend/src/pages/UserList.tsx`, branch `feat/user-groups`, 2026-07-12).
The PATCH body builder had:
```js
if (form.phone.trim() !== origPhone) body.phone = form.phone.trim() || undefined;
```
Clearing an existing phone makes `form.phone.trim()` `''`, so
`'' || undefined` evaluates to `undefined` — and `JSON.stringify` drops keys
whose value is `undefined`, so `phone` never appears in the request body at
all. The backend's PATCH handler (`crudController.partialUpdate` →
`BaseModel.update`) only touches columns actually present in the body, so an
omitted `phone` is indistinguishable from "field not part of this PATCH" —
the old phone number silently survives a user's explicit "clear this field"
action.

**Why:** confirmed by reading `src/middleware/validate.js` (optional fields
skip all further checks when the value is exactly `null`, not just
`undefined` — `if (value === undefined || value === null) continue;`) and
`database/schema.sql` (`users.phone VARCHAR(30) NULL`) — `null` is both
validation-safe and DB-correct for "no phone", unlike sending `''` (which
would also pass but stores an empty string instead of a real NULL) or
omitting the key (which is the actual bug).

**How to apply:** any diff-based PATCH builder for an optional/nullable
string field must special-case the "trimmed value is empty but was
previously non-empty" transition and send `null` explicitly, not
`value || undefined`. Before picking `null` vs `''` for a given field, check
the field's validation schema (`src/middleware/schemas/*.js` — does it skip
`null`, i.e. is it not `required`?) and the DB column's nullability
(`database/schema.sql`) — `null` is usually right when both hold, matching
this codebase's established "optional fields skip on null" `validate()`
convention.
