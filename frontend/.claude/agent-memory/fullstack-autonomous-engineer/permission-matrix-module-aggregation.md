---
name: permission-matrix-module-aggregation
description: The permissions catalog's `module` column aggregates many distinct entity slug-prefixes (e.g. module 'billing' spans invoices.*, payments.*, invoice_settings.*, late_fee_rules.*, ...) — matrix/preset logic must treat "all .view slugs in a module" as a SET, not assume one slug per module.
metadata:
  type: project
---

Discovered while fixing a critical review finding in `RoleList.tsx`'s UCRM-style
permission matrix (`frontend/src/pages/RoleList.tsx`, branch `feat/user-groups`,
2026-07-12). `permissions.module` (see `database/schema.sql`, migrations
119/205/207/218/220/222 etc.) is a coarse grouping label, NOT a 1:1 mapping to
the slug's own prefix — e.g. module `'billing'` alone contains `invoices.*`,
`payments.*`, `plans.*`, `refund_requests.*`, `chargebacks.*`,
`billing_adjustments.*`, `billing_disputes.*`, `invoice_settings.*`,
`late_fees.*`, `payment_plans.*`, `payment_reminders.*`,
`cash_reconciliation.*` — each with its own `.view`/`.create`/`.update`/`.delete`.
Module `'clients'` aggregates similarly.

**How to apply:** any code deriving a "preset" (View/Edit/Denied) per module
from the permission catalog must:
- Extract the action as the slug segment after the LAST dot
  (`slug.lastIndexOf('.')`), never by stripping an assumed `${module}.` prefix
  — most prefixes within an aggregated module do NOT equal the module name.
- Treat "the module's View preset" as the FULL SET of every `.view`-action id
  in the module (there can be many), not a single found id — same for state
  detection (selected-set-equals-view-set, not selected-set-has-length-1).
- Only ever mutate the CRUD ids belonging to the module being toggled; never
  touch other modules' or the module's own "special" (non-CRUD-action) ids —
  that's what keeps a module left in Custom state, and specials, unchanged
  through unrelated radio toggles.

See `frontend/src/pages/RoleList.tsx`'s `actionOf`/`viewIdsOf`/
`deriveModuleState`/`applyModuleState` for the corrected implementation, and
`frontend/src/pages/__tests__/RoleList.test.tsx`'s `billing_settings` fixture
(module aggregating `invoice_settings.*` + `late_fee_rules.*`) for a
regression test shape.
