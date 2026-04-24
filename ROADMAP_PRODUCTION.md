# 🛡️ FireISP 5.0 — Production-Hardening Roadmap (v2)

> **Companion to `ROADMAP.md`.** The original roadmap (M1–M5) tracks **feature
> completeness** and is now ✅ across the board. This document tracks the
> **production-readiness** gaps discovered in a deep-dive review on
> 2026-04-23 — i.e. everything that must be true before this software can be
> trusted to run a real ISP without manual babysitting.
>
> The original `ROADMAP.md` is **not** superseded or deleted. New work that
> isn't a defect fix should still be added under the appropriate milestone
> there. This file is purely the production-hardening checklist.

---

## TL;DR — Is It Production-Ready?

**No — not today, but close.** The codebase is feature-complete and well-tested
(2,393 Jest tests / 101 suites passing locally, 0 lint issues, 314 source
files, 163 migrations, 74 routes, 35 services, 21 docs, K8s + production
docker-compose stack). However, a deep dive surfaced:

1. **CI on `main` is red** (run #206, 2026-04-23) with two
   migration-level defects that will block any fresh deployment.
2. **No frontend tests exist** (`frontend/package.json` `test` script is a
   placeholder echo). The React SPA — the only thing operators actually
   touch — has zero automated regression coverage.
3. **A known performance regression** is documented in the changelog
   (`BaseModel.findAll` uses `LIMIT ?/OFFSET ?` over the prepared-statement
   protocol — surfaced by the M4.1 load test, filed as a follow-up bug, not
   yet fixed). This affects every paginated list endpoint.
4. **Operational maturity gaps** typical of a 5.x system that just hit
   feature parity: no DR drill, no SLOs, no SBOM/container scan, no
   pen-test, no SSO, no privacy-compliance evidence (GDPR / LFPDPPP MX).

The fix list below is grouped into **P0 (release-blocking), P1 (must-have
before first paying tenant), P2 (must-have before scaling beyond a single
tenant)**, and **P3 (continuous improvement)**.

---

## Current Status Snapshot (2026-04-23)

| Layer | Status | Notes |
|---|---|---|
| Backend feature completeness | ✅ | All M1–M5 items in `ROADMAP.md` shipped |
| Backend tests | ✅ 2,393 Jest tests / 101 suites, 0 fail | locally |
| Backend lint | ✅ 0 issues | `eslint src/` |
| Frontend feature completeness | ✅ | All M2 + M5.1/M5.2 pages shipped |
| Frontend tests | ❌ none | `frontend/package.json` test script is `echo` |
| Frontend lint | 🟡 type-check only (`tsc --noEmit`) | no ESLint, no a11y |
| CI on `main` | ❌ FAILING (last 5+ runs) | migration 163 FK type, migration 028 DELIMITER |
| Migrations | 🟡 163 files, sequentially numbered | smoke-test broken (see P0-1, P0-2) |
| Schema reconciliation (`schema.sql`) | 🟡 | not fully validated against migrations 158–163 |
| Docker / docker-compose.prod | ✅ MySQL primary+replica, Redis, Nginx, Certbot | not load-validated end-to-end |
| K8s manifests | 🟡 9 YAML files | no Helm chart, no Kustomize overlays, no GitOps |
| Observability | ✅ Prometheus `/metrics`, Pino JSON logs, Sentry, Grafana JSON | no SLOs / error budgets |
| Health probes | ✅ `/health/live`, `/health/ready` | wired in K8s manifests |
| TLS | ✅ Let's Encrypt (HTTP-01) + Cloudflare (DNS-01 wildcard) | bootstrap script exists |
| Backups | ✅ `mysqldump → S3/B2` daily cron | no documented restore drill |
| Auth | ✅ JWT + refresh rotation + 2FA + lockout + RBAC + IP allowlist | no SAML / OIDC / SSO |
| Multi-tenancy | ✅ org-scoped middleware, per-tenant rate limits, org switcher | not load-tested at >10 orgs |
| Compliance | ✅ CFDI 4.0 / SAT, IFT statistical reports | no GDPR / LFPDPPP DSAR flow |
| Supply chain | 🟡 `npm audit --audit-level=high` in CI | no SBOM, no container scan, no signed images |
| Pen-test / DAST | ❌ never performed | — |
| Runbook / on-call | 🟡 `docs/runbook.md` exists | no incident severity matrix, no paging policy |

---

## P0 — Release-Blocking (must land before *any* production cutover)

> These are defects that will cause a fresh `npm run migrate` or `kubectl apply`
> to fail outright. Verified by inspecting CI run #206 logs on 2026-04-23.

### P0.1 — Fix migration 163 (`snmp_traps`) FK type mismatch
- ✅ `organization_id`, `device_id`, `acknowledged_by` changed from `INT UNSIGNED` to `BIGINT UNSIGNED` in both `163_create_snmp_traps_table.sql` and `database/schema.sql`
- ✅ CI assertion added (`Assert FK column types match referenced PK types` step in `database-tests` job) — queries `information_schema` for type mismatches and exits 1 on any mismatch

### P0.2 — Fix migration 028 (`snmp_rollup_events`) `DELIMITER` parsing
- ✅ `src/scripts/migrate.js` now pre-processes each migration file through `splitStatements()` — a DELIMITER-aware parser that tracks the current delimiter, splits on `$$` inside DELIMITER blocks, and executes each statement individually via `conn.query()`
- ✅ 7 unit tests added in `tests/migrate.test.js` covering simple splits, DELIMITER $$ blocks, multiple procedures, empty input, and the real migration 028 file

### P0.3 — Fix the `LIMIT ?/OFFSET ?` paginated-list regression
- ✅ `BaseModel.findAll()` now validates `limit` and `offset` as safe non-negative integers and inlines them directly into the SQL string — eliminates `mysqld_stmt_execute` regression on every paginated list endpoint
- ✅ `tests/crudController.test.js` updated to assert the inlined `LIMIT 100` appears in the SQL string

### P0.4 — Reconcile `database/schema.sql` with migrations 158–163
- ✅ `schema.sql` `snmp_traps` column types corrected (P0.1 above)
- ✅ README.md migration range updated `001–158` → `001–163`; table count updated `108` → `110`
- ✅ `database-tests` CI step "Verify migrations produce expected table count" flipped from WARNING to hard failure (`exit 1`)

### P0.5 — Make CI on `main` green and keep it green
- ✅ CI blockers addressed end-to-end: frontend type-check now regenerates OpenAPI types, SNMP traps tokenStore call fixed, MySQL 8 schema/migration blockers fixed (FK/CHECK action incompatibilities, migration 136 anchor column, migration 141 idempotent index guards, migration 145 enum priority), and Node 22 coverage-threshold step no longer fails with `Argument list too long`
- ✅ Add branch protection on `main` requiring CI to pass (requires GitHub repository settings — cannot be done via code change)

---

## P1 — Must-Have Before First Paying Tenant

### P1.1 — Frontend automated tests
- ✅ Vitest + React Testing Library + jsdom added to `/frontend`; placeholder `test` script replaced with `vitest run`; `test:watch` and `test:coverage` scripts added
- ✅ 43 tests across 11 test files covering: `AuthContext` (login, logout, silent refresh, session restore, error paths), `PrivateRoute` + `hasRole` (redirect, 403, role rank logic), `Login` page (happy path, error, TOTP prompt), `Dashboard` (KPI rendering), `ClientList`, `ContractList`, `InvoiceList`, `PaymentList`, `TicketList`, `UserList` happy paths, `PortalLogin` (happy path, error)
- ✅ Pre-existing bug fixed: `ContractList.tsx` referenced undefined `statusMutation` — replaced with `(suspendMutation.isError || cancelMutation.isError)`
- ✅ `frontend-test` job added to `.github/workflows/ci.yml` — runs `npm --prefix frontend ci`, `npm --prefix frontend test`, and `npm --prefix frontend run lint` on Node 22 for every push/PR

### P1.2 — End-to-end (browser) smoke test
- ✅ Playwright added under `e2e/` (`@playwright/test` ^1.49, own `package.json` + `playwright.config.ts`)
- ✅ Smoke test scenario in `e2e/tests/smoke.spec.ts`: log in (UI) → create client (API setup) → assign plan — New Contract modal (UI) → generate invoice (UI) → record payment (UI) → open ticket (UI) → sign out → assert redirect to /login
- ✅ API health-check test verifies `/health/live` endpoint independently of seed data
- ✅ `docker-compose.e2e.yml` added — runs MySQL + production container (Express + bundled React) + Playwright runner in one `docker compose up` command
- ✅ `e2e` job added to `.github/workflows/ci.yml` — runs after `lint-and-test` and `frontend-test`; starts MySQL service, runs migrations + seed, builds frontend, starts backend server, installs Playwright chromium, runs smoke tests, uploads HTML report as artifact on failure

### P1.3 — Documented disaster-recovery drill
- ✅ `docs/dr-drill.md` created: end-to-end DR drill procedure covering Phase 1 (take backup via `npm run backup` or manual `mysqldump`), Phase 2 (simulate DB destruction), Phase 3 (restore from backup), Phase 4 (referential-integrity + financial-consistency SQL verification queries + app preflight), Phase 5 (restore storage files)
- ✅ Timing record table and Quarterly Drill Log appended in `docs/dr-drill.md`; operators commit a new row after each quarterly drill
- ✅ RTO target documented: total drill ≤ 60 minutes; breach triggers a P1 issue

### P1.4 — Production secrets management
- ✅ `docs/secrets-management.md` created — documents four supported options: **K8s Sealed Secrets** (recommended default), External Secrets Operator + AWS Secrets Manager, External Secrets Operator + GCP Secret Manager, HashiCorp Vault Agent Injector. Each option includes copy-paste manifests/commands. Bare-metal (systemd `LoadCredential` + env-file) also covered. Checklist at the end.
- ✅ `k8s/sealed-secret.yaml` added — `SealedSecret` template (bitnami-labs/sealed-secrets) covering all 18 FireISP secrets; inline kubeseal quick-start, rotation steps, and airgapped-cluster instructions.
- ✅ `src/utils/logger.js` updated — Pino `redact` list added with 62 paths covering common secret field names (`password`, `secret`, `token`, `authorization`, `accessToken`, `refreshToken`, `apiKey`, `privateKey`), all known env-var names (`JWT_SECRET`, `ENCRYPTION_KEY`, `DB_PASSWORD`, `SMTP_PASS`, `TWILIO_AUTH_TOKEN`, `STRIPE_SECRET_KEY`, `CONEKTA_API_KEY`, `PAC_PASSWORD`, `RADIUS_SECRET`, `REDIS_PASSWORD`, `BACKUP_S3_SECRET_KEY`, `CF_API_TOKEN`, …), and HTTP request fields (`req.headers.authorization`, `req.body.password`, etc.). Censor value is `[REDACTED]`.
- ✅ Audit confirmed: no secrets ever returned by `/health`, `/health?detail=true`, `/health/live`, `/health/ready`, `/healthz` — responses contain only operational metadata (status, version, uptime, relay, memory stats, DB latency).
- ✅ `tests/secretsAudit.test.js` added — 11 tests: health endpoints return no secret env-var names, `/health?detail=true` response keys are whitelisted, Pino redact censors `password`/`secret`/`authorization`, REDACT_PATHS source-level coverage assertion for all critical vars.

### P1.5 — Container image hardening + SBOM
- ✅ `Dockerfile` upgraded from `node:18-alpine` → `node:22-alpine` in both build stages (aligns with CI Node 22)
- ✅ `k8s/deployment.yaml` container `securityContext` added: `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities: {drop: [ALL]}`; pod `securityContext` gains `seccompProfile: {type: RuntimeDefault}`; `/tmp` emptyDir volume added for transient writes
- ✅ `container-scan` CI job added to `.github/workflows/ci.yml` — builds image with `docker buildx`, generates SPDX SBOM via `anchore/sbom-action@v0.18.0` (uploaded as 90-day artifact), scans with `aquasecurity/trivy-action@0.35.0` failing on `HIGH`/`CRITICAL` CVEs (SARIF report uploaded), installs cosign and signs the image keylessly (Fulcio + Rekor) on every push to `main` when `REGISTRY` is configured
- ✅ `k8s/cosign-policy.yaml` added — Sigstore policy-controller `ClusterImagePolicy` requiring valid keyless signature issued by the GitHub Actions OIDC identity for `vothalvino/fireisp5.0` on the `main` workflow; includes Helm install + namespace-label instructions

### P1.6 — Pre-production load + soak test
- ✅ `src/scripts/loadtest-soak.js` added — low-rate (default 5 connections), configurable-duration soak runner; tracks RSS growth per round against a configurable budget (`SOAK_MAX_RSS_GROWTH_MB`, default 100 MB) and error-rate budget (`SOAK_MAX_ERROR_RATE`, default 0.5%); exits non-zero on any violation
- ✅ `loadtest:soak` script added to `package.json` (`node src/scripts/loadtest-soak.js`)
- ✅ `docs/load-testing.md` extended with: production docker-compose stack setup, **regression budget table** (0% errors, p99 ≤ 200 ms single-record, p99 ≤ 500 ms lists, ≥ 500 req/s `/health`, ≥ 100 req/s lists), soak test configuration reference, how-to-interpret-results guide, and release-candidate gate procedure
- ✅ `tests/loadtestSoak.test.js` added — 7 tests covering `probeRssMb()`: successful RSS parse, no-memory field, network error, non-JSON body, non-numeric RSS, plus exports assertions

### P1.7 — Privacy & data-subject compliance
- ✅ `docs/privacy.md` created — full PII field inventory across all tables (`clients`, `contacts`, `client_mx_profiles`, `contracts`, `invoices`, `cfdi_documents`, `payments`, `connection_logs`, `ip_assignments`, `tickets`, `users`, `audit_logs`); lawful basis for each field (LFPDPPP MX + GDPR); retention periods; third-party data processors table; DSAR procedure (LFPDPPP 20-day + GDPR 30-day); full SQL erasure procedure with legal-hold caveat (SAT 10yr, IFT 2yr); DSAR log table for compliance evidence
- ✅ `src/routes/dsar.js` added — `GET /api/v1/dsar/clients/:id`; requires `clients.view` permission; returns a single JSON export of all PII held for the client (client record, contacts, MX profile, contracts, invoices, payments, tickets, last-500 connection logs, IP assignments); mounted under `adminIpAllowlist` in `app.js`
- ✅ `tests/dsar.test.js` added — 6 tests: 200 with full payload, 404 for unknown client, null mxProfile path, ISO timestamp in meta, multi-row connection logs, 500 on DB error

### P1.8 — Observability: SLOs and alerting
- ✅ `docs/slo.md` created — three SLOs defined: **SLO-1** API availability ≥ 99.9% / 30-day (43.8 min/month budget), **SLO-2** API GET p99 ≤ 500 ms / 1-hour window, **SLO-3** RADIUS auth success ≥ 99.95% / 24-hour window; error budget policy table (5%/50%/100% burn-rate actions); burn-rate alert names and thresholds; Alertmanager receiver config template (PagerDuty + email); on-call rotation guidance (single-operator, small team, escalation path); SLO tracking log table
- ✅ `k8s/prometheus-alerts.yaml` added — Prometheus Operator `PrometheusRule` CRD with: SLO-1 fast/slow/long burn-rate alerts (14.4×/6×/3× budget), recording rules for 5 m/30 m/1 h/6 h/24 h error-rate windows, SLO-2 p99 latency fast/slow alerts, SLO-3 RADIUS spike/sustained alerts, plus 3 operational alerts (RSS > 1.5 GB, MySQL pool > 85%, backup overdue > 25 h)

### P1.9 — Incident response runbook
- ✅ `docs/runbook.md` extended with a full **Incident Response** section: SEV1–SEV4 severity matrix (definition, response time, examples), incident declaration criteria, 7-step incident workflow (detect → declare → assign → assess → mitigate → resolve → close), SEV1 step-by-step scenarios (DB down, RADIUS down, payment gateway down, mass suspension, leaked credentials, TLS cert expired), comms templates (SEV1 status-page customer email, SEV1 internal incident-channel bridge, SEV2 degraded notice, resolution email), post-mortem markdown template (timeline, root cause, impact, contributing factors, action items, lessons learned), and escalation path diagram (on-call → engineering lead → all-hands bridge; legal escalation for data breach; finance escalation for payment issues)

---

## P2 — Must-Have Before Scaling Beyond a Single Tenant Org

### P2.1 — SSO / SAML / OIDC for admin users
- ✅ `database/migrations/165_create_sso_configs.sql` added — `organization_sso_configs` (per-org SAML 2.0 + OIDC config, `is_enabled` per provider), `organization_sso_group_mappings` (IdP group → FireISP role), `sso_auth_states` (short-lived OIDC state/nonce store)
- ✅ `src/services/ssoService.js` added — full SAML 2.0 + OIDC flows using `@node-saml/node-saml` and `openid-client@5`; `findOrCreateSsoUser()` with auto-provisioning + group-to-role mapping; `mintTokens()` issues JWT + refresh token; `purgeExpiredStates()` for cleanup
- ✅ `src/routes/sso.js` added — browser-facing: `GET /sso/:orgId/saml/login`, `GET /sso/:orgId/saml/metadata`, `POST /sso/:orgId/saml/acs`, `GET /sso/:orgId/oidc/login`, `GET /sso/:orgId/oidc/callback`; admin (JWT + owner/admin): CRUD for SAML/OIDC config and group mappings
- ✅ `src/config/index.js` — `FEATURE_SSO` feature flag added (default `false`); SSO routes gated by the flag
- ✅ `database/schema.sql` — all three SSO tables appended
- ✅ `tests/sso.test.js` added — 38 tests covering: `parseAttributeMapping`, `normalizeSamlProfile`, `normalizeOidcProfile`, `findOrCreateSsoUser` (existing user, group mapping, auto-provision, no-provision guard, no-email guard), `mintTokens`, `getConfig`, `saveConfig` (create + update), `getGroupMappings`, `saveGroupMappings` (success + rollback), `purgeExpiredStates`, and all 10 route integration tests (feature-flag disabled, SAML/OIDC config CRUD, group-mapping CRUD, invalid orgId, saml/login config-missing)

### P2.2 — Penetration test + remediation
- ✅ `dast` CI job added to `.github/workflows/ci.yml` — spins up MySQL, runs migrations + seed, starts the Express backend, then runs **OWASP ZAP Baseline Scan** (`zaproxy/action-baseline@v0.14.0`); uploads ZAP HTML + JSON report as a 30-day artifact on every push/PR to `main`; `fail_action: false` for the initial baseline so findings can be reviewed without blocking CI (flip to `true` after suppressing accepted risks in `.zap/rules.tsv`)
- ✅ `.zap/rules.tsv` added — suppresses 6 known false positives / accepted risks (HSTS enforced at proxy, Permissions-Policy API-only, timestamp fields, helmet nosniff, self-hosted SRI, bundled third-party eval)
- ✅ `docs/pentest.md` created — full pen-test procedure: DAST CI usage + rule-tuning guide, full manual pen-test scope table, test accounts, OWASP Top-10 checklist with FireISP controls, high-priority test cases (IDOR, auth bypass, rate limiting, SQLi, sensitive-data exposure), findings register (initial baseline entries), scheduling table (CI on every run, full scan quarterly, third-party annually), re-test procedure

### P2.3 — Multi-tenant data isolation audit
- ✅ `fast-check@^4.7.0` added as devDependency for property-based testing
- ✅ `tests/multitenantIsolation.test.js` added — 26 tests across 4 sections: **(1)** property-based SQL tests (fast-check, 10–20 random runs each) asserting `findById`, `findAll`, and `count` always embed `AND organization_id = ?` in the SQL for all 15 org-scoped models; cross-org isolation property (Org A's `findById` always returns `null` for Org B records); non-org-scoped sub-resource models confirmed to have no org filter; **(2)** route-level GET tests — 9 endpoints (`clients`, `contracts`, `invoices`, `payments`, `tickets`, `devices`, `plans`, `credit-notes`, `ip-pools`) return HTTP 404 when the DB mock returns empty for the requesting org; **(3)** mutation isolation — PUT/PATCH/DELETE on `clients`, `contracts`, `invoices` return 404 for cross-org records; **(4)** static wiring checks — 6 core routers confirmed to call `router.use(orgScope)`, orgScope source confirmed to read `req.user.organizationId` (never `req.query/body/params.orgId`)

### P2.4 — Per-tenant resource quotas
- Already have per-tenant *rate* limits (M5.4). Add per-tenant *quotas*: max clients, max devices, max storage (PDFs, backups), max scheduled tasks
- Surface the quota usage in the org settings page

### P2.5 — Helm chart + GitOps
- Replace raw `/k8s/*.yaml` with a Helm chart under `/charts/fireisp/`
- Add an Argo CD `Application` manifest example to `/docs/deployment.md`
- Cut versioned chart releases alongside the app version

### P2.6 — Per-tenant database isolation option
- Today every tenant shares one schema with `organization_id` columns. For high-value tenants offer an opt-in "physically isolated database" mode (one DB per org), driven by a tenant-config table. Critical for some MX banks/carriers as an RFP requirement.

### P2.7 — Background job platform
- The optional `bullmq` dependency suggests this was started. Migrate the home-grown `taskRunner` (cron-style) to BullMQ for: webhook retries (M5.5), SMS queue (M5.3), config-backup pulls (M3.1), CFDI stamping retries — anything that needs delayed/retried/distributed execution
- Required to move from single-instance to horizontally-scaled deployments without duplicate task execution

---

## P3 — Continuous Improvement (nice-to-have, post-launch)

- API: GraphQL gateway in front of the REST API for the frontend (eliminates over-fetching on detail pages)
- Frontend: accessibility audit (axe-core in CI, target WCAG 2.1 AA)
- Frontend: i18n message catalogue audit — claim is EN/ES/pt-BR but no message-key coverage report exists
- Frontend: dark mode
- Frontend: in-app changelog/feature-announcement panel
- Backend: switch from JWT-in-localStorage to httpOnly+SameSite cookies for the admin SPA (removes XSS-token-theft class of bugs)
- Backend: server-sent events → WebSocket migration for live dashboards (lower latency, fewer reconnects)
- Backend: GraphQL subscription for ticket comments / device status changes
- DevEx: pre-commit hooks (husky + lint-staged) so contributors can't push lint-failing commits
- DevEx: replace `npm` with `pnpm` for faster CI installs
- DevEx: spec-driven development — generate route handlers from `docs/openapi.json` to eliminate drift
- Docs: video walkthroughs of the data-migration flow and the FireRelay agent install
- Compliance MX: integrate with Buró de Crédito for credit-decision automation on plan upgrades
- Compliance MX: PROFECO complaint export tool

---

## How This File Stays Current

1. Each item begins as `❌` (open) or `🟡` (in progress) and flips to `✅` only when the work has shipped **and** been verified in production-like conditions (not just unit tests).
2. New defects discovered post-launch are added as new P0/P1 items in this file, not in `ROADMAP.md` (which remains the *feature* roadmap).
3. Once every P0 + P1 item is `✅`, the TL;DR is updated to **"Yes — production-ready as of <date>"**.
4. Same anti-patterns from `ROADMAP.md` apply: one PR = one item, never delete completed items, mark `✅` in the same PR that completes the work.

---

## Changelog

| Date | Section | Change |
|---|---|---|
| 2026-04-23 | — | Roadmap v2 created from production-readiness deep dive (CI run #206 red, frontend-test gap, LIMIT/OFFSET regression, operational maturity gaps) |
| 2026-04-23 | P0.1–P0.5 | P0 items resolved: migration 163 FK types, migration 028 DELIMITER parser, BaseModel LIMIT/OFFSET inlining, schema.sql/README sync, CI table-count hard failure, FK type CI assertion |
| 2026-04-23 | P1.1 | Frontend automated tests: Vitest + RTL, 43 tests / 11 suites, ContractList `statusMutation` bug fixed, `frontend-test` CI job wired |
| 2026-04-23 | P1.2 | E2E smoke test: Playwright `e2e/` package, smoke scenario (login → create client → new contract → generate invoice → record payment → new ticket → sign out), `docker-compose.e2e.yml`, `e2e` CI job |
| 2026-04-23 | P1.3 | DR drill: `docs/dr-drill.md` — 5-phase procedure (backup → destroy → restore → verify RI/counts/financials → storage), timing template, quarterly log table |
| 2026-04-23 | P1.4 | Secrets management: `docs/secrets-management.md` (Sealed Secrets recommended + ESO/AWS/GCP + Vault + bare-metal options), `k8s/sealed-secret.yaml` template, Pino `redact` list in `src/utils/logger.js`, health-endpoint secrets audit, 10 new tests in `tests/secretsAudit.test.js` |
| 2026-04-23 | P1.5 | Container hardening: `node:18-alpine` → `node:22-alpine`, K8s `capabilities.drop=[ALL]` + `readOnlyRootFilesystem` + `seccompProfile=RuntimeDefault` + `/tmp` emptyDir, `container-scan` CI job (Trivy `HIGH`/`CRITICAL` exit-1 + SBOM via anchore/sbom-action + keyless cosign signing on main), `k8s/cosign-policy.yaml` (Sigstore ClusterImagePolicy) |
| 2026-04-24 | P1.6 | Pre-production load + soak test: `src/scripts/loadtest-soak.js` (low-rate round-based soak, RSS growth budget, error-rate budget, exit 1 on violation), `loadtest:soak` npm script, `docs/load-testing.md` extended (production docker-compose stack, regression budget table, soak test configuration reference, RC gate procedure), 7 new tests in `tests/loadtestSoak.test.js` |
| 2026-04-24 | P1.7 | Privacy & compliance: `docs/privacy.md` (full PII field inventory, LFPDPPP + GDPR lawful basis, retention periods, erasure procedure, DSAR procedure, third-party processors, DSAR log), `src/routes/dsar.js` (`GET /api/v1/dsar/clients/:id` DSAR export endpoint, admin-IP-allowlisted), wired in `src/app.js`, 6 new tests in `tests/dsar.test.js` |
| 2026-04-24 | P1.8 | SLOs & alerting: `docs/slo.md` (SLO-1 availability 99.9%, SLO-2 p99 ≤ 500 ms, SLO-3 RADIUS 99.95%, error budget policy, burn-rate alert table, Alertmanager config template, on-call rotation), `k8s/prometheus-alerts.yaml` (PrometheusRule CRD — 10 alerts: 3 SLO-1 burn-rate, 2 SLO-2 latency, 2 SLO-3 RADIUS, 3 operational; 5 recording rules) |
| 2026-04-24 | P1.9 | Incident response runbook: `docs/runbook.md` extended with SEV1–SEV4 severity matrix, declaration criteria, 7-step incident workflow, 6 SEV1 step-by-step scenarios (DB down, RADIUS down, payment gateway, mass suspension, leaked credentials, TLS expired), comms templates, post-mortem markdown template, escalation path |
| 2026-04-24 | P2.1 | SSO / SAML 2.0 + OIDC: `database/migrations/165_create_sso_configs.sql` (3 new tables: organization_sso_configs, organization_sso_group_mappings, sso_auth_states), `src/services/ssoService.js` (`@node-saml/node-saml` + `openid-client@5`, auto-provision, group→role mapping, mintTokens), `src/routes/sso.js` (browser-facing SAML/OIDC flows + JWT-protected admin config/group-mapping CRUD), `FEATURE_SSO` feature flag (default off), schema.sql updated, 38 new tests in `tests/sso.test.js` |
| 2026-04-24 | P2.2 | OWASP ZAP DAST: `dast` CI job (`zaproxy/action-baseline@v0.14.0` — MySQL service + migrations + seed + backend start + ZAP passive scan, ZAP report artifact 30-day retention), `.zap/rules.tsv` (6 false-positive suppressions), `docs/pentest.md` (pen-test procedure, OWASP Top-10 checklist, findings register, scheduling, re-test guide) |
| 2026-04-24 | P2.3 | Multi-tenant isolation audit: `fast-check@^4.7.0` devDependency, `tests/multitenantIsolation.test.js` (26 tests — property-based SQL org-filter assertions for 15 models, cross-org isolation property, 9 GET route isolation tests, 5 mutation isolation tests, 7 middleware wiring checks) |
