# 🗺️ FireISP 5.0 — Development Roadmap

> **Single source of truth.** Before asking "what should I build next?", check this file.
> Update this file with every PR — mark items ✅ when done, never delete them.

---

## How to Use This Roadmap

1. **Pick the next `⬜ TODO` item** from the current milestone — work top-to-bottom
2. **One PR = one checklist item** — never bundle unrelated work
3. **Mark `✅ DONE` in the same PR** that completes the work
4. **Never open a "deep dive" or "next steps" PR** — update this file instead
5. **If scope changes**, add a new item under the right milestone with a note on _why_

---

## Current Status Snapshot

| Layer | Status | Notes |
|---|---|---|
| Database schema | ✅ 157 migrations, 108 tables | schema.sql synced |
| API routes | ✅ 69 route files | 184 OpenAPI paths |
| Services | ✅ 27 service modules | billing, CFDI, RADIUS, payments, etc. |
| Middleware | ✅ Auth, RBAC, validation, rate limiting | circuit breaker added |
| Tests | ✅ 2021 Jest tests / 83 suites | 13 supertest-based integration files |
| Frontend (SPA) | ✅ React + TypeScript SPA in `/frontend` (Vite, openapi-fetch, React Query, role-based routing) | Built to `frontend/dist/`; served by Express in production |
| Docs | ✅ 17 doc files in `/docs` | architecture, API guide, runbook, data-migration |
| Infrastructure | 🟡 Docker + K8s manifests exist | Not production-validated |
| CI/CD | ✅ GitHub Actions pipeline | lint + test on push |

---

## Milestone 1: Production-Ready Backend ✅ COMPLETE (2026-04-20)

> Goal: The API server can be deployed and handle real ISP operations reliably.
> All sub-items below shipped. Backend is feature-complete for first deployment;
> remaining production work lives in Milestone 4.

### 1.1 — Data Integrity & Migrations
- ✅ Complete schema through migration 150
- ✅ Guard triggers for critical business rules
- ✅ schema.sql reconciled with all migrations
- ✅ Add migration smoke test in CI (run all migrations against empty MySQL 8 in Docker)
- ✅ Add rollback scripts for migrations 130–150

### 1.2 — API Completeness
- ✅ CRUD routes for all 101 tables
- ✅ Validation schemas wired into routes
- ✅ Bulk operations endpoints
- ✅ Pagination consistency audit (ensure every list endpoint supports `?page=&limit=`)
- ✅ Add `PATCH` partial-update support to top 10 most-used resources (clients, contracts, invoices, devices, payments, tickets, plans, users, organizations, sites)
- ✅ Implement soft-delete across all resources (archive instead of `DELETE`)

### 1.3 — Authentication & Security
- ✅ JWT auth + 2FA (TOTP)
- ✅ RBAC with role-permission matrix
- ✅ CORS hardening, rate limiting, helmet
- ✅ Add refresh token rotation (access token 15 min, refresh token 7 days)
- ✅ Add API token scoping (read-only vs read-write per resource)
- ✅ Add brute-force lockout (5 failed login attempts → 15 min cooldown)

### 1.4 — Payment Processing
- ✅ Stripe/Conekta/PayPal webhook receivers
- ✅ Idempotency keys, auto-reconciliation
- ✅ Add payment retry logic (failed charge → retry 3x over 72 hours)
- ✅ Implement proration calculation for mid-cycle plan changes
- ✅ Add payment receipt PDF generation (integrate with existing pdfService)
- ✅ End-to-end test: create client → assign plan → generate invoice → process payment → verify ledger

### 1.5 — MX Compliance (CFDI / SAT)
- ✅ CFDI 4.0 XML generation, line items, tax breakdown
- ✅ PAC provider integration, CSD certificate management
- ✅ Factura pública (venta al público en general)
- ✅ Add CFDI cancellation flow (submit to SAT, track acceptance/rejection)
- ✅ Add complemento de pago generation for partial payments
- ✅ Add monthly CFDI reconciliation report (issued vs SAT acknowledgments)

### 1.6 — Automated Billing Cycle _(moved from Milestone 5 — core revenue engine, not polish)_
- ✅ Automated billing cycle (cron: generate invoices → email → suspend overdue)

### 1.7 — Pre-deployment Safety _(moved up — needed before UAT/launch)_
- ✅ Add database backup cron job (mysqldump → S3/B2 daily)
- ✅ Build import tool for existing ISP data (clients, contracts, devices from CSV/Excel)
- ✅ Build import tool for legacy billing system (invoices, payments)
- ✅ Document data migration runbook in `/docs/data-migration.md`

---

## Milestone 2: Frontend Application

> Goal: Admin panel is usable by real ISP operators, not just API consumers.
> Note: the existing `/public` directory is a legacy vanilla-JS SPA shell. It will be **replaced**, not extended, by the work below. Leave it in place until the new frontend reaches feature parity for Milestone 2.2 pages, then remove.

### 2.1 — Framework & Tooling
- ✅ **Pick the frontend framework** (React + TypeScript / Vue 3 / SvelteKit) — record decision in `/docs/adr/0001-frontend-framework.md` with rationale (team familiarity, ecosystem, SSR need). Blocks every item below.
- ✅ Audit and regenerate `/docs/openapi.json` against the 69 route files (the spec is the contract for the auto-generated client; verify it matches reality before generating)
- ✅ Validate `/healthz` returns 200 with DB+Redis status _(moved from 4.1 — needed by frontend dev proxy and load balancer alike)_
- ✅ Scaffold chosen framework in `/frontend` with Vite + dev proxy to API
- ✅ Generate typed API client from `/docs/openapi.json` and wire into `/frontend`
- ✅ Implement auth flow (login → store JWT → silent refresh on 401 → logout)
- ✅ Implement role-based UI routing (admin sees everything, technician sees limited)

### 2.2 — Core Pages (MVP)
> **Definition of done for M2:** an operator can onboard a client, generate and send an invoice, record a payment, open a ticket, and check device status — all without ever calling the API directly.
- ✅ Dashboard (KPIs: active clients, MRR, overdue invoices, open tickets, device uptime)
- ✅ Client list + detail (contracts, invoices, payments, devices, ledger)
- ✅ Contract management (create, renew, suspend, cancel)
- ✅ Invoice list + detail (generate, send email, download PDF, record payment)
- ✅ Payment recording (manual entry + payment gateway status)
- ✅ Ticket list + detail (create, assign, comment, close)
- ✅ Device/network map (sites, links, SNMP status)
- ✅ User management (create, assign roles, enable 2FA)
- ✅ Remove legacy `/public` SPA once parity is reached

### 2.3 — Advanced Pages (Post-MVP)
- ✅ CFDI management (stamp, cancel, download XML/PDF)
- ✅ Inventory/warehouse management
- ✅ RADIUS session viewer (live PPPoE sessions)
- ✅ SNMP metrics charts (bandwidth, uptime, per-device)
- ✅ Reports page (revenue, churn, usage, IFT statistical)
- ✅ Settings (org config, email templates, alert rules, payment gateways)

---

## Milestone 3: Network Operations

> Goal: FireRelay + SNMP + RADIUS work end-to-end with real MikroTik hardware.

### 3.1 — FireRelay (Remote Router Management)
- ✅ FireRelay service architecture + clustering design
- ✅ Implement WebSocket tunnel between agent and central server
- ✅ Implement FireRelay agent process (Node.js) that runs at remote POP sites and connects via the tunnel
- ✅ Add RouterOS API commands: PPPoE create/delete, queue set, address-list add/remove
- ✅ Add config backup pull (automated nightly backup via agent)
- ⬜ Test with real MikroTik hAP (lab environment)

### 3.2 — SNMP Monitoring
- ✅ SNMP poller service, wide metrics table, monthly partitioning
- ✅ OID profile system per vendor/model
- ✅ Add threshold-based alerting (e.g., bandwidth > 90% → create ticket automatically)

### 3.3 — RADIUS / PPPoE
- ✅ FreeRADIUS schema, NAS table, pool management
- ✅ RADIUS service for auth/acct/CoA
- ⬜ Test PPPoE auth flow end-to-end (MikroTik → FreeRADIUS → FireISP DB)
- ✅ Implement CoA disconnect (suspend client → kick active session immediately)
- ✅ Add session accounting dashboard (data usage per client per day)

---

## Milestone 4: Production Deployment

> Goal: Running in production with real ISP clients and data.

### 4.1 — Infrastructure
- ✅ Dockerfile, docker-compose.yml, K8s manifests
- ✅ Add production docker-compose (with MySQL replication, Redis, Nginx reverse proxy)
- ✅ Add TLS termination config (Let's Encrypt / Cloudflare)
- ⬜ Implement IP allowlist for admin endpoints _(moved from 1.3 — network-layer firewalls preferred; existing auth stack is strong)_
- ⬜ Load test API with realistic ISP workload (500 clients, 5000 invoices, 100 devices)

### 4.2 — Observability
- ✅ Prometheus metrics endpoint
- ✅ Add structured JSON logging across all services (Pino JSON logger adopted; 28+ services use it)
- ✅ Add request tracing (requestId middleware already correlates across logs)
- ⬜ Build Grafana dashboards for API latency, error rates, and DB query times — start from `/docs/grafana` templates _(consolidated from 3.2 + 4.2 duplicate)_
- ⬜ Add Sentry or equivalent error tracking

---

## Milestone 5: Scale & Polish

- ⬜ Client self-service portal (view invoices, pay online, open tickets)
- ⬜ Mobile-responsive frontend
- ⬜ SMS notification integration (Twilio/local MX provider)
- ⬜ API rate limiting per tenant
- ⬜ Webhook delivery retry with exponential backoff
- ⬜ Performance: add Redis caching to top 10 most-queried endpoints
- ⬜ Performance: add database read replica routing for reports
- ⬜ Coverage zone map editor (draw polygons on map) _(moved from 2.3 — high effort, low MVP impact)_
- ⬜ Add SNMP trap receiver (for unsolicited device alerts) _(moved from 3.2 — polling covers 90% of needs)_
- ⬜ Multi-tenant support (multiple ISP organizations in one instance) _(prove single-tenant first)_

---

## ❌ Anti-Patterns to Avoid

| Don't Do This | Do This Instead |
|---|---|
| Open a "deep dive" or "analyze next steps" PR | Read this roadmap and pick the next `⬜` item |
| Bundle 10 features into one giant PR | One PR = one checklist item |
| Re-sync schema.sql in a separate PR | Include schema.sql update in the migration PR |
| Re-document README for every schema change | Update README once per milestone |
| Ask Copilot "what should I build?" | Check this file — it already tells you |
| Create a branch without a matching roadmap item | Add the item to this roadmap first |

---

## 📝 Changelog

| Date | Milestone | Item | PR |
|---|---|---|---|
| 2026-04-14 | — | Roadmap created | #TBD |
| 2026-04-14 | 1.1 | Migration smoke test in CI | #TBD |
| 2026-04-15 | 1.1 | Rollback scripts for migrations 130–150 | #TBD |

| 2026-04-16 | 1.2 | Pagination consistency audit | #TBD |
| 2026-04-18 | 1.3 | Refresh token rotation (access 15m, refresh 7d) | #TBD |
| 2026-04-18 | 1.3 | API token scoping (read-only vs read-write per resource) | #TBD |
| 2026-04-18 | 1.4 | Payment retry logic (failed charge → retry 3x over 72h) | #TBD |
| 2026-04-18 | — | Roadmap reprioritization: mark 4 done items (lockout, proration, logging, request tracing), move billing cycle to M1.6, move data migration/backups to M1.7, demote IP allowlist to M4.1, demote coverage map/SNMP traps to M5 | #TBD |
| 2026-04-18 | 1.4 | Payment receipt PDF generation (pdfService + route + send-receipt) | #TBD |
| 2026-04-18 | 1.4 | E2E test: client → plan → invoice → payment → ledger (16 tests) | #TBD |
| 2026-04-18 | 1.5 | CFDI cancellation flow (submit to SAT, track acceptance/rejection) | #TBD |
| 2026-04-18 | 1.5 | Complemento de pago 2.0 generation for partial/full PPD payments | #TBD |
| 2026-04-18 | 1.5 | Monthly CFDI reconciliation report (issued vs SAT acknowledgments) | #TBD |
| 2026-04-18 | 1.6 | Automated billing cycle: invoice emails, suspension warnings, post-suspension emails, billing_cycle orchestrator task | #TBD |
| 2026-04-18 | 1.7 | Database backup cron job: mysqldump → gzip → S3/B2 daily (migration 156, cloudStorageService, SigV4 auth) | #TBD |
| 2026-04-18 | 1.7 | Import tool: clients, contracts, devices from CSV/Excel (XLSX); file-upload endpoints + exceljs parser | #TBD |
| 2026-04-20 | 1.7 | Import tool for legacy billing: invoices & payments from CSV/Excel; JSON + file-upload endpoints | #TBD |
| 2026-04-20 | 1.7 | Data migration runbook: pre-migration checklist, import order, column reference, verification queries, rollback | #TBD |
| 2026-04-20 | — | Roadmap deep-dive refresh: corrected Status Snapshot counts (155→156 migrations, 101→108 tables, 55+→69 routes, 24→27 services, 16→17 docs, frontend & tests rows); marked M1 complete; sharpened M2.1 (framework decision ADR, OpenAPI audit, `/healthz` validation moved up, legacy `/public` retirement); added M2 MVP definition-of-done; collapsed redundant FireRelay parent bullet in 3.1; de-duplicated Grafana items in 4.2 | #TBD |
| 2026-04-20 | 2.1 | Frontend framework: React + TypeScript ADR; /auth/refresh added to OpenAPI spec (185 paths); /healthz endpoint (DB+Redis); React+TS+Vite scaffold in /frontend; openapi-fetch typed client; AuthContext (JWT in memory, refresh token in localStorage, silent refresh on 401); PrivateRoute role guard (admin/billing/technician/support/read-only) | #TBD |
| 2026-04-20 | 2.2 | Dashboard KPI page: active clients, MRR, overdue invoices, open tickets, device uptime cards + overdue invoices table; fetches /dashboard/summary, /dashboard/mrr, /dashboard/device-health, /dashboard/overdue via React Query | #TBD |
| 2026-04-21 | 2.2 | Client list + detail: searchable/paginated ClientList; ClientDetail with 5 tabs (Contracts, Invoices, Payments, Devices, Ledger); status badges; breadcrumb nav | #TBD |
| 2026-04-21 | 2.2 | Contract management: ContractList page with status filter, pagination, New Contract modal (client+plan+type+dates+IP), Renew modal (reactivate + set end date), Suspend/Cancel confirmation dialogs with per-row action buttons | #TBD |
| 2026-04-21 | 2.2 | Invoice list + detail: InvoiceList (status filter, pagination, Generate Invoice modal), InvoiceDetail (metadata, line items, send-email action, download-PDF action, record-payment modal with allocation); backend POST /invoices/:id/send-email | #TBD |
| 2026-04-21 | 2.2 | Payment recording: PaymentList page (status filter, pagination), Record Payment modal (client, amount, method, status, date, reference, optional invoice allocation), inline allocation drawer, gateway transaction status drawer, Send Receipt action | #TBD |
| 2026-04-21 | 2.2 | Ticket list + detail: TicketList (status/priority filter, pagination, New Ticket modal), TicketDetail (metadata, quick-action status buttons, assign to user, comments thread with internal-note toggle) | #TBD |
| 2026-04-21 | 2.2 | Device/network map: sites as collapsible cards with device chips (status badge, SNMP indicator), Unassigned group, network links table (device A/B, type, capacity, status), summary bar (sites, devices, online/offline, SNMP monitored, active links), site name + device status filters | #TBD |
| 2026-04-21 | 2.2 | User management: paginated user table (role/status filter), New User modal (name/email/password/role/phone/status), Edit User modal (role change + info update), 2FA setup wizard (TOTP secret + OTPAuth URL + verify code + backup codes) and 2FA disable flow for the current user | #TBD |
| 2026-04-21 | 2.2 | Remove legacy /public SPA: deleted /public dir, Express now serves frontend/dist/, Dockerfile updated to multi-stage build (frontend build → production image), README updated | #TBD |
| 2026-04-21 | 2.3 | CFDI management: paginated CFDI document list (status + type filters), Stamp modal (PAC timbrado confirmation), Cancel modal (SAT reason codes 01–04, optional replacement UUID), Download XML/PDF per-row actions; route /cfdi accessible to billing+ roles | #TBD |
| 2026-04-21 | 2.3 | Inventory/warehouse management: InventoryList page (category+status filters, pagination, New/Edit Item modals, Stock modal across warehouses, Record Transaction modal); WarehouseList page (status filter, pagination, New/Edit Warehouse modals, Stock Levels modal with search); routes /inventory + /warehouses accessible to technician+ | #TBD |
| 2026-04-21 | 2.3 | RADIUS session viewer: live PPPoE sessions table (username/IP/NAS filters, auto-refresh 30s, duration, bytes ↓/↑); GET /connection-logs/active endpoint; POST /radius/:id/disconnect endpoint; route /radius-sessions (technician+) | #TBD |
| 2026-04-21 | 2.3 | SNMP metrics charts: device selector, time range (24h raw/7d hourly/30d daily), interface selector, SVG line charts (bandwidth ↓/↑, CPU, memory, signal, latency), summary bar; GET /snmp-metrics + GET /snmp-metrics/devices endpoints; route /snmp-metrics (technician+) | #TBD |
| 2026-04-21 | 2.3 | Reports page: Revenue tab (financial summary KPIs + bar chart, date-range picker), Subscriber Growth tab (new vs churned line chart + monthly table, churn rate KPI), AR Aging tab (bucket KPIs + bar chart + searchable overdue-invoice table), IFT Statistical tab (paginated list + detail modal + create modal); 4 new OpenAPI paths added (financial, aging, subscriber-growth, technicians) | #TBD |
| 2026-04-21 | 2.3 | Settings page: Org Config (key/value settings editor), Email Templates (CRUD for message_templates), Alert Rules (CRUD with enable/disable toggle), Payment Gateways (CRUD for payment gateways); new /api/v1/message-templates route added; schema.sql synced with migration 157 (ift_statistical_reports: concession_title_id FK, subscribers_by_municipality, subscribers_by_customer_type, subscribers_by_payment_modality, notes columns) | #TBD |
| 2026-04-21 | 3.1 | WebSocket tunnel: TunnelServer class with auth handshake (shared secret), heartbeat ping/pong, command dispatch (sendCommand → Promise), agent connect/disconnect events, DB status hooks; attached to HTTP server at /ws/firerelay; GET /api/firerelay/tunnel/agents + POST /api/firerelay/tunnel/command routes; 21 new Jest tests | #TBD |
| 2026-04-21 | 3.1 | RouterOS API commands: pppoe.create/delete, queue.set, addressList.add/remove — routerosService.js (RouterOS API protocol client, 5 handlers); firerelay-agent.js wired; 42 new Jest tests | #TBD |
| 2026-04-21 | 3.1 | Config backup pull: configBackupService.js (pullBackupForDevice, runNightlyBackups, SHA-256 dedup); config.backup RouterOS handler (/export); migration 158 (firerelay_node_id on devices + config_backup_pull task); POST /device-config-backups/pull route; 47 new Jest tests | #TBD |
| 2026-04-21 | 3.2 | Threshold-based alerting: bandwidth metrics (if_in_octets, if_out_octets) added to ALLOWED_METRICS; autoCreateTicket() in alertService; auto_create_ticket flag on alert_rules (migration 159); alert schema + routes updated; 14 new Jest tests | #TBD |
| 2026-04-21 | 3.3 | CoA disconnect: POST /contracts/:id/suspend (suspensionService.suspendContract → RADIUS Disconnect-Request code 40) and POST /contracts/:id/unsuspend (suspensionService.reconnectContract → RADIUS CoA-Request code 43); frontend ContractList updated to use dedicated suspend endpoint; 2 new OpenAPI paths; 12 new Jest tests | #TBD |
| 2026-04-21 | 3.3 | Session accounting dashboard: GET /connection-logs/daily-usage (per-client per-day aggregation with date range + optional client_id/contract_id filters) and GET /connection-logs/top-consumers (top N by bytes in period); SessionAccounting.tsx page (date picker, summary bar, SVG daily bar chart, top-10 table, paginated daily breakdown); route /session-accounting (technician+); 2 new OpenAPI paths; 14 new Jest tests | #TBD |
| 2026-04-22 | 4.1 | Production docker-compose: MySQL primary+replica (GTID streaming), Redis (AOF + password), Nginx reverse proxy (HTTP→HTTPS, TLS 1.2/1.3, rate limiting, WebSocket pass-through); nginx/nginx.conf, mysql/primary.cnf, mysql/replica.cnf, mysql/init-replica.sh | #TBD |
| 2026-04-22 | 4.1 | TLS termination config: Let's Encrypt HTTP-01 (nginx/init-letsencrypt.sh bootstrap, certbot service in docker-compose.prod.yml, certbot-deploy-hook.sh, 6h nginx hot-reload); Cloudflare DNS-01 wildcard cert support (cloudflare.ini.example, --cloudflare flag); docs/tls-setup.md + deployment.md updated | #TBD |
