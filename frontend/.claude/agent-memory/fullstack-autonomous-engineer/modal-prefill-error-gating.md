---
name: modal-prefill-error-gating
description: When an edit modal prefills a checklist/set from a GET that can fail, gate save-validity on the query's isError state explicitly — don't rely solely on "the local state is still null", since a user interacting with the (wrongly-empty) checklist can silently reseed it and make a stale/incomplete save look valid.
metadata:
  type: feedback
---

Found as a major review finding in `UserList.tsx`'s Edit User modal
(`frontend/src/pages/UserList.tsx`, branch `feat/user-groups`, 2026-07-12):
`EditUserModal` prefilled its organization-access checklist from
`GET /users/:id/organizations` into local state (`orgIds`, initialized `null`,
set via a `useEffect` keyed on the query's `data`). The Save button's `valid`
guard checked `orgIds !== null` — which looks like it already protects against
saving on a failed prefill. It doesn't: `toggleOrg` (the checkbox onChange
handler) does `new Set(prev ?? [])`, so the FIRST checkbox click after a
failed prefetch reseeds `orgIds` from an empty Set, taking it out of `null`
and silently making `valid` true again — with only the just-toggled org(s),
not the user's real (never-loaded) memberships. Saving then wiped their
actual org access. No error was ever shown either, so nothing hinted this
had happened.

**Why:** the reviewer traced through "is Save actually blocked on a failed
GET" and found the guard was defeated by ordinary checkbox interaction, not
just theoretically stale — a real click-through would trigger it.

**How to apply:** for any modal that prefills editable local state from a
query that can fail, gate the submit/save validity directly on
`query.isError` (in addition to / instead of "is local state still null"),
show an inline error + a retry (`query.refetch()`) action, and disable the
editable control itself while `isError` is true so local state literally
cannot leave its "not yet loaded" shape via user interaction. See
`OrgCheckboxList`'s `disabled` prop and `EditUserModal`'s `valid` computation
in `frontend/src/pages/UserList.tsx` for the applied fix, and the "shows an
inline error and disables Save when org prefill fails" test in
`frontend/src/pages/__tests__/UserList.test.tsx` for the regression test
shape (fails the first `/users/:id/organizations` call, succeeds on retry).
