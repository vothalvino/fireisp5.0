---
name: user-groups-frontend-matrix
description: RoleList.tsx was rebuilt as a UCRM-style "User groups" editor (matrix permission UI) on branch feat/user-groups — now fully i18n'd under userGroups.* (en/es/pt-BR).
metadata:
  type: project
---

`frontend/src/pages/RoleList.tsx` (+ `__tests__/RoleList.test.tsx`) was rebuilt
2026-07-12 on branch `feat/user-groups` as the frontend half of
[[user-groups-roles-hardening]]. "Roles" are now presented to the user as
**User groups**. Key implementation points worth knowing before touching this
page again:

- **CRUD vs special split** is derived client-side from `Permission.slug` +
  `Permission.module` (the catalog row's `module` column is authoritative;
  falls back to splitting the slug on its first dot if a row's slug doesn't
  actually start with `${module}.`). Action is CRUD only if it is *exactly*
  `view`/`create`/`update`/`delete` — anything else (including multi-segment
  actions like `manage_customers`, or single non-CRUD verbs like `export`,
  `scan`, `execute`) is a "special" permission rendered as its own checkbox,
  grouped under its module heading. A module with zero CRUD slugs never gets
  a matrix row — it only appears in the Special permissions section.
- **Matrix state derivation** (`deriveModuleState`): Denied = no CRUD ids of
  that module selected; View = *exactly* the module's `.view` id selected;
  Edit = every CRUD id of that module selected; anything else (including a
  module with no `.view` slug at all) = Custom, rendered as a 4th radio that
  is always `disabled` and only shows checked when the computed state is
  `custom` — the user can never click it directly, only preset choices move
  the selection out of Custom.
- **Save is a single bulk `PUT /roles/{id}/permissions`** with the full
  `Set<number>` of selected ids (CRUD-derived + checked specials), replacing
  the old one-toggle-per-request POST/DELETE pattern from before migration
  378.
- **admin-kind groups** (`role.kind === 'admin'`, i.e. the seeded `admin` /
  `super_admin` system groups) render the matrix **read-only** with a notice
  banner — the backend 403s any PUT to their permission set since RBAC
  bypasses them entirely (see [[user-groups-roles-hardening]]), so editing
  would be misleading UI even before the request round-trips.
- **"Start from" template on create**: copying a template's permissions is a
  client-side two-step (`GET /roles/{id}` on the template → `PUT
  /roles/{id}/permissions` on the newly-created group with those ids) — there
  is no backend "clone" endpoint.
- **i18n (2026-07-12 follow-up, done)**: all strings now live under
  `userGroups.*` (54 leaf keys, en/es/pt-BR) plus a handful of reused
  `common.*`/`pagination.*` keys (`common.edit`, `common.delete`,
  `common.cancel`, `common.saving`, `common.loading`, `common.id`,
  `pagination.prevPage`/`nextPage`/`pageInfo`) — deliberately reused instead
  of duplicating under `userGroups.*` since those exact English strings
  already existed and are pulled from `common`/`pagination` by ~20+ other
  pages (including `UserList.tsx`'s own `t('common.edit')`). Two *pairs* of
  visually-identical-but-distinct strings needed separate keys because tests
  assert on both independently: the dialog `aria-label` (e.g. "Edit group
  {{name}}") vs. the visible `<h2>` heading (e.g. "Edit Group — {{name}}"),
  and same for the Permissions modal ("Permissions for {{name}}" aria-label
  vs. "Permissions — {{name}}" heading). Client-side fallback error strings
  (used only when the backend response has no proper JSON `error.message`)
  can't use `t()` in the module-level `fetch*`/`createRole`/etc. helpers
  (hooks don't work outside components), so those helpers now take an
  explicit `fallbackMessage: string` parameter that each calling component
  fills in via its own `t()` — see `apiErrorMessage()` usage in
  `RoleList.tsx`. `KIND_LABELS`/`ASSIGNABLE_KINDS` module-level constants
  were replaced with `ALL_KIND_VALUES`/`ASSIGNABLE_KIND_VALUES` value-only
  arrays plus dynamic `t(\`userGroups.kind.${value}\`)` lookups inside the
  components that render them (module-level code can't call `useTranslation`)
  — dynamic-template-literal `t()` keys are an established pattern elsewhere
  in this codebase (e.g. `ChargebackList.tsx`, `BillingAdjustmentList.tsx`).
  Both `RoleList.test.tsx` and `UserList.test.tsx` needed **zero** edits —
  neither file mocks `react-i18next`; both let the real i18n instance
  (imported once in `src/test/setup.ts`) resolve real English strings, so
  keeping the English catalogue values identical to the original hardcoded
  text was enough. `UserList.tsx`'s Group/Organization-Access modal fields
  are under `userList.newUserModal.*` and `userList.editUserModal.*`
  (`group`/`orgAccess` duplicated per-modal since they're separate JSX
  instances; `orgHint`/`orgLoading`/`noOrgs` live only under `newUserModal`
  and are reused by the shared `OrgCheckboxList` subcomponent regardless of
  which modal renders it). Pre-existing fields unrelated to the group/org
  rework (First/Last Name, Password, Phone, Status, the whole 2FA wizard,
  "New User"/"Edit User" modal titles) were deliberately left hardcoded —
  out of scope for this pass.

See also [[openapi-pattern]] (the `as never` cast pattern used for
`PUT /roles/{id}/permissions`, whose generated type has `query?: never` /
`Record<string, never>` bodies since the spec entry is hand-written with a
generic `jsonBody()`-style schema) and [[testing-conventions]] for the
duplicate-accessible-name gotcha this page's tests hit.
