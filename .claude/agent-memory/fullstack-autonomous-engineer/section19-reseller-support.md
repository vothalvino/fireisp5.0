---
name: section19-reseller-support
description: Section 19 Multi-Tenancy/Reseller Support — migrations 344-347 complete; 7 new tables (310 total), 22 perms, 2 route files + 6-tab frontend page; next migration: 348
metadata:
  type: project
---

Migrations 344-347 complete on branch `19-of-isp-platform-feature.md`.

**What was built:**
- 4 migrations + 4 rollbacks
- 7 new tables: resellers (self-ref hierarchy, white-label branding), reseller_plan_prices, reseller_commissions, reseller_ip_pool_allocations, reseller_bandwidth_quotas, reseller_olt_port_assignments, reseller_billing_entities
- `reseller_id BIGINT UNSIGNED NULL` FK added to clients table (migration 345 stored-proc guard)
- 22 permissions (module='resellers') seeded to admin/reseller_admin/super_admin
- resellerService: getResellerSubtree, getResellerClientIds, getResellerDashboard, recordCommission
- Routes: `/api/v1/resellers` (19 endpoints) + `/api/v1/reseller-portal` (7 endpoints)
- Frontend: ResellerPage.tsx (6 tabs), App.tsx + Layout.tsx nav
- i18n: ~50 keys added to en/es/pt-BR under reseller namespace + nav.resellers
- 59 Jest tests in tests/section19.test.js

**Key lessons from Section 19:**
- Auth guard in test mockDb() must match `users` table via `` s.includes('`users`') `` (backtick-quoted) or `s.includes('users') && s.includes('WHERE id = ?')` — NOT via `!s.includes('SELECT *')` because User.findById also uses SELECT *
- Commission approve test: existence check query includes `reseller_id = ?`, post-UPDATE re-read does not — must disambiguate
- Coverage at 72.31% after adding 13 extra branch-coverage tests (empty clientIds, wrong reseller_id, inactive reseller, parent_id filters)
- Self-referencing FK: `CONSTRAINT fk_resellers_parent FOREIGN KEY (parent_id) REFERENCES resellers (id) ON DELETE SET NULL ON UPDATE CASCADE`

**Total database state:** 310 tables, migrations 001-347
**Next migration number: 348**

**Why:** [[section18-automation-scripting]] preceded this; reseller support is a product feature (reseller_id scoping like organization_id), NOT hard multi-tenant isolation.
**How to apply:** Next feature section continues from migration 348.
