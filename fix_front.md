# fix_front.md — Plan to Fix & Complete the FireISP Admin Frontdesk

## Goal

Make the admin frontend (the "frontdesk", `frontend/src`) fully functional: repair the
broken/partial pages, standardize how the UI talks to the API, and surface the large set
of features that already exist in the database and backend API but have no UI today.

---

## Status snapshot (current)

- **Phase 1 (repair existing pages): ✅ complete** — Clients, Devices, Reports/exports,
  mutation-pattern normalization, and the missing edit/delete/allocate actions are all in.
- **Phase 2 (new feature pages): in progress** — Milestones **M1–M6 done** (billing core,
  network core, support/SLA, admin/security, compliance/MX).
- **Remaining work is tracked as milestones M7–M11 in Section 7** (billing extras, remaining
  network/ops, support+compliance, administration, then cross-cutting hardening & sign-off).

---

## 1. Diagnosis — why so much of the frontdesk "doesn't work"

The backend is far richer than the UI exposes:

- **215 documented API endpoints** (`docs/openapi.json`) and **123 database tables**
  (`database/schema.sql`).
- Only **~29 admin pages** exist (`frontend/src/pages/*.tsx`), and most are **read-only**.

The problem is **not** a single global failure. Specifically, the CSRF concern that looks
suspicious is a *false positive*: the backend exempts Bearer-token requests from CSRF
(`src/middleware/csrf.js:155-157`) and the typed client always sends a ******
(`frontend/src/api/client.ts:74-82`). So mutations are not globally blocked.

Instead, the frontdesk fails for three concrete reasons:

### A. Core pages are read-only (no create/edit/delete)
Backend fully supports CRUD, but the UI never calls it. Examples verified in code:
- `pages/ClientList.tsx` — only Search + pagination; **no New/Edit/Delete client**, even
  though `src/routes/clients.js:26-29` exposes POST/PUT/PATCH/DELETE.
- `pages/ClientDetail.tsx` — read-only tabs; cannot edit client, manage contacts
  (`/clients/:id/contacts`), MX profile (`/clients/:id/mx-profile`), or portal password
  (`/clients/:id/portal-password`).
- `pages/DeviceMap.tsx` — view only; `src/routes/devices.js:29-63` supports create/update/
  delete/restore.
- `pages/Dashboard.tsx`, `Reports.tsx`, `SessionAccounting.tsx`, `SnmpMetrics.tsx`,
  `RadiusSessions.tsx` — analytics/list views with little or no action surface.

### B. Inconsistent data-mutation patterns
Three different styles are mixed, which makes pages fragile and cache state stale:
- **Good:** React Query `useMutation` + typed `api.POST/PATCH/DELETE` (e.g. `UserList`,
  `Settings`, `TicketDetail`).
- **Bypass:** raw `fetch()` with manual headers (e.g. `TicketList.tsx` createTicket,
  `InvoiceList.tsx` generateFlexibleInvoice) — loses type-safety and centralized refresh.
- **Broken cache:** `async/await` + local `setSubmitting` instead of `useMutation`
  (e.g. `InventoryList.tsx`, `WarehouseList.tsx`) — list caches are not invalidated, so the
  UI looks like "nothing happened" after a successful write.

### C. Whole feature areas have no UI at all
Backend routes/tables exist with zero frontdesk pages (see Section 4).

**Net effect:** an operator cannot perform most day-to-day frontdesk tasks (onboard a
client, edit details, manage plans/quotes/expenses, etc.), which is what "90% doesn't work"
describes.

---

## 2. Guiding principles for all changes

- **Reuse the typed client.** Route every call through `api` (`frontend/src/api/client.ts`)
  so auth refresh and types apply. Retire raw `fetch()` in pages.
- **Standardize on React Query** `useQuery`/`useMutation`, and always invalidate the
  relevant query keys on success so lists refresh automatically.
- **Permission-aware UI.** Show/enable action buttons based on the user's permissions/role
  (mirroring `requirePermission(...)` in the routes) using the existing `PrivateRoute`/
  role helpers, so non-privileged users do not see actions that will 403.
- **Keep the OpenAPI schema authoritative.** New endpoints must be present in
  `docs/openapi.json` (the client schema is generated from it via `gen:api`), otherwise the
  typed client cannot call them.
- **Match existing conventions**: page layout, modal/dialog pattern with
  `role="dialog"`/`aria-modal` (see existing Invoice/Payment/Ticket modals), i18n keys in
  `frontend/src/i18n`, and nav registration in `components/Layout.tsx`.
- **Minimal, incremental, testable.** Each page/feature is its own slice with its own tests.

---

## 3. Phase 1 — Repair existing broken/partial pages

Priority order (highest operator impact first):

- [x] **1. Clients (critical).**
  - [x] `ClientList`: add "New Client" create modal, per-row Edit and Delete (soft-delete) +
    Restore, wired to `POST/PUT/DELETE /clients` and `POST /clients/:id/restore`.
  - [x] `ClientDetail`: add Edit client form; add management for Contacts, MX profile, and
    portal password using the existing sub-resource endpoints.
- [x] **2. Devices.** Add create/edit/delete/restore on `DeviceMap` (or a companion list view)
  against `/devices`.
- [x] **3. Reports.** Wire the "generate/export" actions to the report endpoints
  (`/reports`, `/export`) so reports can actually be produced, not just viewed.
  (`Reports.tsx` now has revenue/growth/aging/IFT/technicians tabs plus an Exports tab that
  downloads CSV through the typed client via `/export/{clients,contracts,invoices,payments}`.)
- [x] **4. Normalize mutation patterns (tech-debt fixes that cause "did nothing" bugs):**
  - [x] Convert `InventoryList` and `WarehouseList` from `async/await + local state` to
    `useMutation` with query invalidation; add Delete actions.
  - [x] Convert `TicketList` and `InvoiceList` raw `fetch()` calls to the typed `api` client.
- [x] **5. Fill missing edit/delete on partial pages:** invoices (edit/void), payments
  (edit/delete/manual allocate via `api.POST /payments/{id}/allocate`), contracts
  (edit/delete/suspend/cancel), ticket comments (edit/delete). Only expose actions that have
  backend support; otherwise add the endpoint first.

Deliverable for Phase 1: every existing list/detail page supports the full set of
operations its backend route already provides. **✅ Phase 1 complete.**

---

## 4. Phase 2 — Add frontdesk features that exist in the DB/API but have no UI

Group the missing surfaces into new pages (each with list + create/edit/delete as the
backend allows), registered in `App.tsx` routes and `components/Layout.tsx` nav with the
appropriate role gate. Candidate areas, mapped to existing routes/tables:

**Billing & sales**
- [x] Plans & plan add-ons — `/plans` (`src/routes/plans.js`).
- [x] Quotes & quote items, convert-to-invoice — `/quotes`.
- [x] Credit notes — `/credit-notes`.
- [x] Expenses — `/expenses`.
- [ ] Promotions / tax rules / tax rates — backend + `promotions`, `tax_rules`, `tax_rates`.
- [ ] Recurring payment profiles — `/recurring-payment-profiles`.
- [ ] Payment gateways & transactions detail — `/payment-gateways`, `/payment-transactions`.

**Network / operations**
- [x] Sites — `/sites`.
- [x] NAS devices — `/nas`.
- [x] IP pools & IP assignments — `/ip-pools`, `/ip-assignments`.
- [x] VLANs and network links — `/vlans`, `/network-links`.
- [x] Service areas — `/service-areas` (read view).
- [x] Outages — `/outages` (read view).
- [x] Speed tests, connection logs, network health — `/speed-tests`, `/connection-logs`,
  `/network-health` (read/analytics views).
- [x] SNMP profiles — `/snmp-profiles` (read view; metrics/traps UIs already exist).
- [x] Device config backups — `/device-config-backups` (read view).
- [ ] Suspension rules & suspension actions — `/suspension-rules` (read view added), `/suspension`.

**Support & SLAs**
- [x] SLA definitions — `/sla-definitions`.
- [ ] Message templates — `/message-templates` (currently only partially in Settings).

**Compliance (MX) & regulatory**
- [x] CSD certificates, PAC providers, SAT catalogs — `/csd-certificates`, `/pac-providers`,
  `/sat-catalogs`.
- [x] Regulatory filings — `/regulatory-filings`.
- [ ] Concession titles, IFT statistical reports, facturas públicas.

**Administration & security**
- [x] Roles & permissions editor — `/roles` (assign `role_permissions`).
- [x] API tokens — `/api-tokens`.
- [x] Webhooks & deliveries — `/webhooks`.
- [x] Audit logs viewer — `/audit-logs`.
- [x] Scheduled tasks & job/queue status — `/scheduled-tasks`, `/jobs`, `/queue-stats`.
- [x] Organizations management — `/organizations`.
- [x] DSAR and DR-drill admin tools — `/dsar`, `/dr-drill`.

For each new page:
- [ ] Confirm the endpoints are present in `docs/openapi.json`; if missing, add them first so
  the generated client is typed.
- [ ] Build list view → create/edit modal → delete/restore, all via `useMutation` + typed
  `api`, with permission-gated actions.
- [ ] Register route in `App.tsx` under the correct role group and add the nav entry +
  i18n labels.

Sequence Phase 2 by operator value: Plans → Quotes → Credit notes → Expenses → Sites/NAS →
IP pools/assignments → SLA definitions → Roles/permissions → remaining network → compliance
→ admin/security tooling.

---

## 5. Cross-cutting work

- [ ] **i18n:** add keys for every new label/action in `frontend/src/i18n` (both locales used).
- [ ] **Shared UI primitives:** factor a reusable CRUD list + modal-form pattern to avoid
  re-implementing per page and to keep behavior/accessibility consistent.
- [ ] **Empty/error/loading states** standardized across pages.
- [ ] **Navigation grouping:** as the number of pages grows, group the sidebar into sections
  (Clients/Billing/Network/Compliance/Admin) in `components/Layout.tsx`.
- [ ] **Documentation:** keep `docs/openapi.json` and any feature docs in sync; CI validates
  schema/migration counts (per repo conventions).

---

## 6. Validation & testing

- [ ] **Per slice:** component tests (`frontend/src/pages/__tests__` / `src/test`) for the new
  create/edit/delete flows, asserting the correct typed `api` call and query invalidation.
- [ ] **Type/build gate:** `pnpm --filter fireisp-frontend lint` (runs `gen:api` + `tsc`) and
  `build` must pass — this also guarantees every called endpoint exists in the schema.
- [ ] **Backend:** add/extend route tests for any endpoints introduced for missing UIs.
- [ ] **E2E smoke:** extend the Playwright smoke flow to cover the new critical paths
  (create client → contract → invoice → payment) once e2e CI is re-enabled.
- [ ] **Manual RBAC check:** verify action buttons appear only for permitted roles.

---

## 7. Milestones

### Completed

- [x] **M1 – Clients & Devices fully operational** (Phase 1 items 1–2). Highest impact.
- [x] **M2 – Pattern normalization + missing edit/delete** (Phase 1 items 3–5: Reports
  export, Inventory/Warehouse `useMutation`, Ticket/Invoice typed client, contract/payment
  edit-delete-allocate). **Phase 1 is now fully complete.**
- [x] **M3 – Core billing/sales pages** (Plans, Quotes, Credit notes, Expenses).
- [x] **M4 – Network/operations pages** (Sites, NAS, IP pools/assignments, VLANs, etc.).
- [x] **M5 – Support/SLA + Admin/security pages** (SLA defs, Roles/permissions, API tokens,
  Webhooks, Audit logs, Scheduled tasks).
- [x] **M6 – Compliance/MX pages** (CSD, PAC, SAT catalogs, regulatory filings).
- [x] **M7 – Billing & sales completion** (Promotions, Tax rules, Tax rates CRUD; Payment
  gateways, Payment transactions, Recurring payment profiles read views).

### Remaining — next stages to "done"

Everything below is the rest of Phase 2 + cross-cutting work, sequenced by operator value.
Each milestone is independently shippable. For every new page follow the per-page checklist
in Section 4 (confirm endpoint in `docs/openapi.json` → list → create/edit modal →
delete/restore via `useMutation` + typed `api` → register route/nav/i18n → tests).

- [x] **M7 – Billing & sales completion.**
  - [x] Recurring payment profiles — `/recurring-payment-profiles` (route exists; read view added).
  - [x] Payment gateways — `/payment-gateways` (route exists; read view added — secret keys stay in the secure flow).
  - [x] Payment transactions detail — `/payment-transactions` (route exists; read view added).
  - [x] Promotions / tax rules / tax rates — added CRUD routes (`promotions`, `tax-rules`,
    `tax-rates`) + OpenAPI generator entries + route tests, then built the CRUD pages.
- [x] **M8 – Network & operations completion** (routes already exist; add read views):
  - [x] Service areas — `/service-areas` (read view; boundary is WGS-84 POLYGON geometry).
  - [x] Outages — `/outages` (read view).
  - [x] Speed tests / connection logs / network health — `/speed-tests`,
    `/connection-logs`, `/network-health` (read/analytics views).
  - [x] SNMP profiles — `/snmp-profiles` (read view; metrics/traps UIs already exist).
  - [x] Device config backups — `/device-config-backups` (read view).
  - [x] Suspension rules — `/suspension-rules` (read view; suspension actions stay on the
    contract/client flows).
- [x] **M9 – Support & compliance completion** (routes exist; add pages):
  - [x] Message templates — `/message-templates` (promoted out of Settings into its own full-CRUD page).
  - [x] Concession titles — `/concession-titles` (read view).
  - [x] IFT statistical reports — `/ift-statistical-reports` (read view).
  - [x] Facturas públicas — `/facturas-publicas` (read view).
- [x] **M10 – Administration & security completion** (routes exist; add pages):
  - [x] Organizations management — `/organizations` (full CRUD + settings/quota sub-resources).
  - [x] DSAR admin tooling — `/dsar`.
  - [x] DR-drill admin tooling — `/dr-drill`.
- [ ] **M11 – Cross-cutting hardening & sign-off** (Sections 5 & 6):
  - [ ] Factor the repeated list+modal pattern into a shared CRUD primitive
    (`crudStyles.tsx` already exists as a starting point) and migrate pages onto it.
  - [ ] Group the sidebar into sections (Clients/Billing/Network/Compliance/Admin) in
    `components/Layout.tsx`.
  - [ ] Standardize empty/error/loading states across all pages.
  - [ ] Complete i18n coverage for every label/action in all locales (`en`, `es`, `pt-BR`).
  - [ ] Per-slice component tests for each remaining create/edit/delete flow.
  - [ ] Re-enable and extend the Playwright e2e smoke flow (create client → contract →
    invoice → payment) once e2e CI is restored.
  - [ ] Final gate: `pnpm --filter fireisp-frontend lint` (gen:api + tsc) and `build` pass,
    backend `jest` passes, and OpenAPI `spec:check` (spec-drift) passes.

**Definition of done:** every backend route that represents a frontdesk operation has a
permission-gated UI surface, all mutations use the typed `api` client + React Query
invalidation, i18n is complete, and the lint/build/test/spec-drift gates are green.
