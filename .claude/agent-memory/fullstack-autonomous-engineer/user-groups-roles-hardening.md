---
name: user-groups-roles-hardening
description: Migration 378 turned `roles` into UCRM-style "user groups" (roles.kind, users.group_id); roles.js route hardening (kind guard, is_system guard, bulk permissions endpoint) done on branch feat/user-groups.
metadata:
  type: project
---

Migration 378 (`database/migrations/378_user_groups.sql`) repurposed the existing
`roles` table as reusable "user groups": added `roles.kind` (ENUM admin/billing/
support/technician/readonly — the built-in persona a group is based on) and
`users.group_id` (FK → roles, authoritative permission source). `users.role`
stays as a synced mirror of the group's kind via `User.resolveGroupMirror`
(`src/models/User.js`). Full resolution order is documented in
`User.getPermissions`'s docstring: group_id (authoritative) → organization_users
membership role-by-name → legacy users.role fallback.

**Why kind='admin' is dangerous for custom groups:** `rbac.js`'s
`requirePermission` bypasses ALL permission checks when `req.user.role ===
'admin'`. Since a group's `kind` mirrors into `users.role`, a custom group with
`kind: 'admin'` would grant its members a full RBAC bypass regardless of what's
actually in `role_permissions` for that group — the permission list becomes
decorative. Only the seeded system groups ('admin', 'super_admin') may carry
`kind: 'admin'`; this is enforced both in the validation schema (enum excludes
'admin' for createRole/updateRole) and again at the route layer in
`src/routes/roles.js` (defense in depth, since schemas can drift).

**roles.js hardening done 2026-07-12** (PUT/DELETE/bulk-permissions guards):
- `POST /roles` — `kind` is now required (enum: billing/support/technician/
  readonly, NOT admin) and persisted.
- `PUT /roles/:id` — fetches the existing role first; if `is_system` is
  truthy, rejects (403) any attempt to change `name` or `kind` (description-
  only edits stay allowed). Rationale worth remembering: permission
  resolution throughout the codebase (`User.getPermissions`,
  `#EFFECTIVE_PERMISSION_PREDICATE`) joins `roles` **by name** against
  `organization_users.role` / `users.role` — renaming a system role like
  'admin' would silently orphan every legacy-role-based grant in the install.
- `DELETE /roles/:id` — rejects `is_system` roles (403) and rejects roles with
  any active user still pointing at them via `users.group_id` (422, "reassign
  users first").
- New `PUT /roles/:id/permissions` — bulk-replace a role's permission set
  (DELETE-then-INSERT, plain sequential `db.query` calls, no transaction —
  roles.js didn't already use `db.getConnection`/transactions anywhere, so a
  new one wasn't introduced just for this). Blocks editing when
  `role.kind === 'admin'` (checked by kind, not name, so it also covers
  'super_admin') since that group's permission rows are moot under the RBAC
  bypass. For non-legacy-admin callers, the privilege-amplification guard
  (mirrors the existing single-permission `POST /:id/permissions` guard)
  applies only to the DELTA: added slugs must be held by the caller
  (`User.getPermissions`), removed slugs are always allowed — so a
  pure-removal request never needs to resolve the caller's own permissions at
  all, which also kept its test mocking simpler.

**Multi-agent parallel build note:** this feature was built by several
concurrently-running agents each scoped to a disjoint file set (one on
`src/routes/roles.js` + `src/middleware/schemas/roles.js` + the Roles section
of `src/utils/openapi.js`, others presumably on `src/models/User.js`,
`src/routes/users.js`, `src/middleware/schemas/users.js`,
`src/middleware/restrictRoleAssignment.js`, frontend group-editor pages, etc.
— visible via `git status` showing those files modified outside this agent's
own edits). When `pnpm run openapi` is run by an agent that only edited one
section of `src/utils/openapi.js`, the regenerated `docs/openapi.json` still
picks up *every* other concurrently-edited section too, since it's a full
regen from the shared generator file — this is expected/harmless as long as
`pnpm run spec:check` reports 0 drift afterward, not a sign of scope creep.

**Known follow-up (not done by this agent, flagged for whoever finalizes):**
making `roles.kind` required on create is a breaking schema change.
`tests/coreRoutes.test.js` and `tests/routesCoverage.test.js` have pre-378
`POST /api/roles` / `PUT /api/roles/:id` tests that don't send `kind` and
whose PUT mocks assume the old 2-query flow (UPDATE then SELECT, no
pre-fetch) — both will fail against the hardened routes until updated. Left
untouched deliberately (out of this agent's owned-file scope); whoever runs
the full `pnpm test` at Finalize needs to reconcile them.

See also [[openapi-pattern]] for the `jsonBody(desc)`/schema-naming
convention, and [[testing-conventions]] for the mocked-DB supertest pattern
(`tests/profeco.test.js` is the reference example this test file followed).
