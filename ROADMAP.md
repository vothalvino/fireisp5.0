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
| Database schema | ✅ 150 migrations, 101 tables | schema.sql synced |
| API routes | ✅ 55+ route files | 184 OpenAPI paths |
| Services | ✅ 24 service modules | billing, CFDI, RADIUS, payments, etc. |
| Middleware | ✅ Auth, RBAC, validation, rate limiting | circuit breaker added |
| Tests | ✅ 77.5% coverage | 162 integration tests |
| Frontend (SPA) | 🟡 30 pages scaffolded in `/public` | Needs real UI framework |
| Docs | ✅ 16 doc files in `/docs` | architecture, API guide, runbook |
| Infrastructure | 🟡 Docker + K8s manifests exist | Not production-validated |
| CI/CD | ✅ GitHub Actions pipeline | lint + test on push |

---

## Milestone 1: Production-Ready Backend

> Goal: The API server can be deployed and handle real ISP operations reliably.

### 1.1 — Data Integrity & Migrations
- ✅ Complete schema through migration 150
- ✅ Guard triggers for critical business rules
- ✅ schema.sql reconciled with all migrations
- ⬜ Add migration smoke test in CI (run all migrations against empty MySQL 8 in Docker)
- ⬜ Add rollback scripts for migrations 130–150

### 1.2 — API Completeness
- ✅ CRUD routes for all 101 tables
- ✅ Validation schemas wired into routes
- ✅ Bulk operations endpoints
- ⬜ Pagination consistency audit (ensure every list endpoint supports `?page=&limit=`)
- ⬜ Add `PATCH` partial-update support to top 10 most-used resources (clients, contracts, invoices, devices, payments, tickets, plans, users, organizations, sites)
- ⬜ Implement soft-delete across all resources (archive instead of `DELETE`)

### 1.3 — Authentication & Security
- ✅ JWT auth + 2FA (TOTP)
- ✅ RBAC with role-permission matrix
- ✅ CORS hardening, rate limiting, helmet
- ⬜ Add refresh token rotation (access token 15 min, refresh token 7 days)
- ⬜ Add API token scoping (read-only vs read-write per resource)
- ⬜ Implement IP allowlist for admin endpoints
- ⬜ Add brute-force lockout (5 failed login attempts → 15 min cooldown)

### 1.4 — Payment Processing
- ✅ Stripe/Conekta/PayPal webhook receivers
- ✅ Idempotency keys, auto-reconciliation
- ⬜ Add payment retry logic (failed charge → retry 3x over 72 hours)
- ⬜ Implement proration calculation for mid-cycle plan changes
- ⬜ Add payment receipt PDF generation (integrate with existing pdfService)
- ⬜ End-to-end test: create client → assign plan → generate invoice → process payment → verify ledger

### 1.5 — MX Compliance (CFDI / SAT)
- ✅ CFDI 4.0 XML generation, line items, tax breakdown
- ✅ PAC provider integration, CSD certificate management
- ✅ Factura pública (venta al público en general)
- ⬜ Add CFDI cancellation flow (submit to SAT, track acceptance/rejection)
- ⬜ Add complemento de pago generation for partial payments
- ⬜ Add monthly CFDI reconciliation report (issued vs SAT acknowledgments)

---

## Milestone 2: Frontend Application

> Goal: Admin panel is usable by real ISP operators, not just API consumers.

### 2.1 — Framework & Tooling
- ⬜ Choose and scaffold frontend framework (React/Vue/Svelte) in `/frontend`
- ⬜ Set up Vite build pipeline + proxy to API in development
- ⬜ Add shared API client (auto-generated from `/docs/openapi.json`)
- ⬜ Add auth flow (login → store JWT → refresh → logout)
- ⬜ Add role-based UI routing (admin sees everything, technician sees limited)

### 2.2 — Core Pages (MVP)
- ⬜ Dashboard (KPIs: active clients, MRR, overdue invoices, open tickets, device uptime)
- ⬜ Client list + detail (contracts, invoices, payments, devices, ledger)
- ⬜ Contract management (create, renew, suspend, cancel)
- ⬜ Invoice list + detail (generate, send email, download PDF, record payment)
- ⬜ Payment recording (manual entry + payment gateway status)
- ⬜ Ticket list + detail (create, assign, comment, close)
- ⬜ Device/network map (sites, links, SNMP status)
- ⬜ User management (create, assign roles, enable 2FA)

### 2.3 — Advanced Pages (Post-MVP)
- ⬜ CFDI management (stamp, cancel, download XML/PDF)
- ⬜ Inventory/warehouse management
- ⬜ RADIUS session viewer (live PPPoE sessions)
- ⬜ SNMP metrics charts (bandwidth, uptime, per-device)
- ⬜ Coverage zone map editor (draw polygons on map)
- ⬜ Reports page (revenue, churn, usage, IFT statistical)
- ⬜ Settings (org config, email templates, alert rules, payment gateways)

---

## Milestone 3: Network Operations

> Goal: FireRelay + SNMP + RADIUS work end-to-end with real MikroTik hardware.

### 3.1 — FireRelay (Remote Router Management)
- ✅ FireRelay service architecture + clustering design
- ⬜ Implement FireRelay agent (Node.js process that runs at remote POP sites)
- ⬜ Implement WebSocket tunnel between agent and central server
- ⬜ Add RouterOS API commands: PPPoE create/delete, queue set, address-list add/remove
- ⬜ Add config backup pull (automated nightly backup via agent)
- ⬜ Test with real MikroTik hAP (lab environment)

### 3.2 — SNMP Monitoring
- ✅ SNMP poller service, wide metrics table, monthly partitioning
- ✅ OID profile system per vendor/model
- ⬜ Add SNMP trap receiver (for unsolicited device alerts)
- ⬜ Build Grafana dashboards using `/docs/grafana` templates
- ⬜ Add threshold-based alerting (e.g., bandwidth > 90% → create ticket automatically)

### 3.3 — RADIUS / PPPoE
- ✅ FreeRADIUS schema, NAS table, pool management
- ✅ RADIUS service for auth/acct/CoA
- ⬜ Test PPPoE auth flow end-to-end (MikroTik → FreeRADIUS → FireISP DB)
- ⬜ Implement CoA disconnect (suspend client → kick active session immediately)
- ⬜ Add session accounting dashboard (data usage per client per day)

---

## Milestone 4: Production Deployment

> Goal: Running in production with real ISP clients and data.

### 4.1 — Infrastructure
- ✅ Dockerfile, docker-compose.yml, K8s manifests
- ⬜ Add production docker-compose (with MySQL replication, Redis, Nginx reverse proxy)
- ⬜ Add TLS termination config (Let's Encrypt / Cloudflare)
- ⬜ Add database backup cron job (mysqldump → S3/B2 daily)
- ⬜ Add health check endpoint for load balancer (`/healthz` already exists, validate it)
- ⬜ Load test API with realistic ISP workload (500 clients, 5000 invoices, 100 devices)

### 4.2 — Observability
- ✅ Prometheus metrics endpoint
- ⬜ Add structured JSON logging across all services (replace console.log)
- ⬜ Set up Grafana dashboard for API latency, error rates, DB query times
- ⬜ Add Sentry or equivalent error tracking
- ⬜ Add request tracing (correlate requestId across logs)

### 4.3 — Data Migration
- ⬜ Build import tool for existing ISP data (clients, contracts, devices from CSV/Excel)
- ⬜ Build import tool for legacy billing system (invoices, payments)
- ⬜ Document data migration runbook in `/docs/data-migration.md`

---

## Milestone 5: Scale & Polish

- ⬜ Multi-tenant support (multiple ISP organizations in one instance)
- ⬜ Client self-service portal (view invoices, pay online, open tickets)
- ⬜ Mobile-responsive frontend
- ⬜ SMS notification integration (Twilio/local MX provider)
- ⬜ Automated billing cycle (cron: generate invoices → email → suspend overdue)
- ⬜ API rate limiting per tenant
- ⬜ Webhook delivery retry with exponential backoff
- ⬜ Performance: add Redis caching to top 10 most-queried endpoints
- ⬜ Performance: add database read replica routing for reports

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

<!-- Add a row here every time you complete a roadmap item -->
