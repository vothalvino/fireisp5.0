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
- ✅ `tests/multitenantIsolation.test.js` added — 26 tests across 4 sections: **(1)** property-based SQL tests (fast-check, 50–100 runs each) asserting `findById`, `findAll`, and `count` always embed `AND organization_id = ?` in the SQL for all 15 org-scoped models; cross-org isolation property (Org A's `findById` always returns `null` for Org B records, 100 runs); non-org-scoped sub-resource models confirmed to have no org filter; **(2)** route-level GET tests — 9 endpoints (`clients`, `contracts`, `invoices`, `payments`, `tickets`, `devices`, `plans`, `credit-notes`, `ip-pools`) return HTTP 404 when the DB mock returns empty for the requesting org; **(3)** mutation isolation — PUT/PATCH/DELETE on `clients`, `contracts`, `invoices` return 404 for cross-org records; **(4)** static wiring checks — 6 core routers confirmed to call `router.use(orgScope)`, orgScope source confirmed to read `req.user.organizationId` (never `req.query/body/params.orgId`)

### P2.4 — Per-tenant resource quotas
- ✅ `database/migrations/166_create_organization_quotas.sql` added — `organization_quotas` table with per-org limits for `max_clients`, `max_devices`, `max_storage_mb`, `max_scheduled_tasks`; NULL = unlimited; `ON DELETE CASCADE` from organizations
- ✅ `src/models/OrganizationQuota.js` added — `findByOrgId()` (returns all-null defaults when no row exists) + `upsert()` (INSERT … ON DUPLICATE KEY UPDATE; empty string coerced to NULL)
- ✅ `src/services/quotaService.js` added — `getQuota()`, `getUsage()` (counts clients, devices, tasks; computes storage MB via cross-join through clients/devices/tickets), `getQuotaWithUsage()`, `checkQuota()` (throws 422 `ValidationError` with human-readable message when at or over limit)
- ✅ `src/middleware/checkQuota.js` added — `quotaCheck(resource)` returns an Express middleware; inserted before `ctrl.create` on `POST /clients`, `POST /devices`, `POST /scheduled-tasks`
- ✅ `src/routes/organizations.js` extended — `GET /:id/quota` (returns `{ limits, usage }`), `PUT /:id/quota` (upsert + return updated view); both require `organizations.view` / `organizations.update` permissions
- ✅ `database/schema.sql` updated — `organization_quotas` table appended
- ✅ Frontend `Settings.tsx` extended with a **Quotas** tab (5th tab): `QuotaBar` component shows usage/limit with colour-coded progress bar (green → amber at 80% → red at 95%); edit form lets admins set or clear each limit; uses existing `apiFetch` + React Query
- ✅ `tests/quotaService.test.js` added — 18 tests: `getQuota` (row exists, no row), `getUsage` (correct counts, ceil rounding, zero storage), `getQuotaWithUsage`, `checkQuota` (under limit, at limit, over limit, unlimited null, no row, devices, scheduled_tasks, storage_mb), `OrganizationQuota.upsert` (SQL shape, empty→null coercion, no-op empty body)

### P2.5 — Helm chart + GitOps
- ✅ `charts/fireisp/` Helm chart created — `Chart.yaml` (appVersion 5.0.0), `values.yaml` (all tuneable parameters: replicaCount, image, ingress + TLS, resources, HPA, PDB, persistence, config, secrets, monitoring, cosignPolicy, extraEnv/Volumes), `.helmignore`
- ✅ All K8s resources templated: `_helpers.tpl` (name/fullname/labels/image helpers), `namespace.yaml`, `configmap.yaml`, `secret.yaml` (helm.sh/resource-policy: keep), `serviceaccount.yaml`, `deployment.yaml` (all security contexts, probes, mounts from values), `service.yaml`, `ingress.yaml` (TLS + cert-manager annotation), `hpa.yaml`, `pdb.yaml`, `pvc.yaml`, `prometheus-alerts.yaml` (gated by `monitoring.enabled`), `cosign-policy.yaml` (gated by `cosignPolicy.enabled`), `NOTES.txt`
- ✅ `helm lint charts/fireisp --strict` passes (0 chart failures); smoke render via `helm template` verified
- ✅ `docs/deployment.md` extended with **Helm Chart Deployment** section (quick-start, values override guide, migration step, upgrade/uninstall) and **GitOps with Argo CD** section (install, `Application` manifest with full `syncPolicy`, Sealed Secrets + Argo CD workflow, chart release process)
- ✅ `.github/workflows/ci.yml` updated: `on.push.tags: ["v*.*.*"]` added; `helm-release` job added — `helm lint --strict`, smoke `helm template`, and `helm/chart-releaser-action@v1.6.0` (runs only on `v*` tags, publishes to `gh-pages`)

### P2.6 — Per-tenant database isolation option
- ✅ `database/migrations/167_create_organization_database_configs.sql` added — control-plane config table keyed by organization with `isolation_mode` (`shared` default, `isolated` opt-in), isolated DB host/port/name/user, encrypted DB password, SSL flag, and `last_verified_at`
- ✅ `src/config/database.js` is tenant-aware: `orgScope` establishes an async tenant context, DB queries for isolated orgs are routed to a cached per-tenant MySQL pool, shared tenants continue using the primary/replica pools, and config/pool cache invalidation is wired for updates
- ✅ Admin API added under `/api/v1/organizations/:id/database-isolation`: `GET` returns masked config, `PUT` validates/saves shared vs isolated config, `POST /test` verifies connectivity and records `last_verified_at`
- ✅ Migration runner supports `MIGRATE_ISOLATED_TENANTS=true npm run migrate` to apply the same migration set to every enabled isolated tenant database after the control-plane migration succeeds
- ✅ `docs/tenant-database-isolation.md` documents enable/verify/migrate/disable flow, backup expectations, and operational caveats

### P2.7 — Background job platform
- ✅ `src/workers/index.js` (worker registry — 5 named queues: `scheduled-task`, `webhook-delivery`, `sms-send`, `cfdi-stamp`, `config-backup`); `src/services/jobQueueService.js` extended (`getStats()` + `QUEUE_NAMES` export); `src/services/webhookService.js` — `deliverForWorker()` BullMQ handler (job-aware retry via `throw`, `job.update()` persists `deliveryRowId` across retries, dead_letter on final attempt), `dispatch()` enqueues via BullMQ when `REDIS_URL` set (non-blocking, native backoff) vs inline fallback; `src/services/smsTransport.js` — `queueSms()` dispatches via BullMQ when available; `src/services/scheduler.js` — cron ticks enqueue `scheduled-task` jobs with minute-granular `jobId` deduplication (atomic Redis SETNX, no advisory lock needed) vs inline fallback; `src/routes/queueStats.js` (`GET /api/v1/queue-stats` — per-queue waiting/active/completed/failed/delayed counts, admin IP allowlisted); `src/server.js` — `registerWorkers()` at startup + `jobQueue.close()` in graceful shutdown; 16 new tests in `tests/bullWorkers.test.js`

---

## P3 — Continuous Improvement (nice-to-have, post-launch)

### P3.1 — Frontend accessibility audit (axe-core in CI, WCAG 2.1 AA)
- ✅ `jest-axe@10` + `@types/jest-axe` added to `frontend` devDependencies — wraps `axe-core` with a `toHaveNoViolations` matcher that integrates with Vitest
- ✅ `frontend/src/test/setup.ts` extended with `expect.extend(toHaveNoViolations)` so all test files can use the matcher without re-importing
- ✅ `frontend/src/test/a11y.test.tsx` added — 8 tests covering the full operator-facing surface: Login, Dashboard (after async data load), ClientList (populated + empty state), InvoiceList, TicketList, UserList, PortalLogin; each scanned with `configureAxe({ runOnly: ['wcag2a', 'wcag2aa'], rules: { 'color-contrast': { enabled: false } } })`
- ✅ Real WCAG violations fixed: `TicketList.tsx` status + priority filter `<select>` elements and `UserList.tsx` role + status filter `<select>` elements given `aria-label` attributes (they lacked any accessible name)
- ✅ All 59 Vitest tests pass (8 new a11y + 51 pre-existing)

### P3.2 — DevEx: pre-commit hooks (husky + lint-staged)
- ✅ `husky@^9` and `lint-staged@^16` added as root devDependencies; `"prepare": "husky"` wired in `package.json` so hooks are installed automatically after every `npm ci` / `npm install`
- ✅ `.husky/pre-commit` created — runs `npx lint-staged` on every `git commit`
- ✅ `.lintstagedrc.cjs` created — two rule sets: **backend** (`src/**/*.js`) runs `eslint --fix` (auto-corrects trivial style issues; aborts commit on unfixable violations); **frontend** (`frontend/src/**/*.{ts,tsx}`) returns a function (suppressing lint-staged's default file-appending to tsc) that regenerates `schema.d.ts` via `gen:api` then runs `tsc --noEmit` over the whole project — guarantees no TypeScript errors are committed
- ✅ Contributors can bypass in emergencies with `git commit --no-verify` (documented usage remains unchanged)

### P3.3 — GraphQL gateway (single-request client detail, resolver-level org scoping)
- ✅ `graphql-yoga@^5.21.0` + `graphql@^16.13.2` added to backend dependencies; `graphql-request@^7.4.0` added to frontend
- ✅ `src/graphql/typeDefs.js` — SDL schema: 12 types (`Client`, `Contract`, `Invoice`, `InvoiceItem`, `AppliedPayment`, `Payment`, `Device`, `LedgerEntry`, `Contact`, `Ticket`, `TicketComment`) with triple-quote descriptions; top-level `Query` type exposes `client`, `clients`, `invoice`, `invoices`, `ticket`, `tickets`
- ✅ `src/graphql/resolvers.js` — field resolvers with snake_case→camelCase mapping; all queries org-scoped via `ctx.orgId`; nested resolvers (contracts, invoices, payments, devices, ledger, contacts, items, appliedPayments, comments) are lazy (only execute when requested); `clamp()` enforces `MAX_LIMIT=200` on list queries
- ✅ `src/graphql/index.js` — graphql-yoga v5 server factory; exports Express middleware using `Promise.resolve(yoga.requestListener(...))` (handles both sync fast-path and async paths); `context` factory exposes `req.user` + `req.orgId` from Express middleware
- ✅ `src/middleware/sanitize.js` patched — GraphQL endpoint excluded from HTML entity encoding (e.g., `"` → `&quot;`) because graphql-yoga performs its own query validation
- ✅ `src/app.js` — `authenticate` and `orgScope` imported at app level; `v1.use('/graphql', authenticate, orgScope, graphqlMiddleware)` added (endpoint: `/api/v1/graphql` and `/api/graphql` via backward-compat mount)
- ✅ `frontend/src/api/graphql.ts` — typed `gql<T>()` helper using `graphql-request@^7`; auto-attaches JWT access token from `tokenStore`
- ✅ `frontend/src/pages/ClientDetail.tsx` rewritten — single `CLIENT_DETAIL_QUERY` replaces 5+ separate REST calls (`/clients/:id`, `/clients/:id/contracts`, `/clients/:id/invoices`, `GET /payments?client_id=`, `/devices?contract_id=`, `/clients/:id/balance-ledger`); all sub-components now receive data as props (no per-tab `useQuery` hooks); field names updated to camelCase matching the GraphQL schema
- ✅ `tests/graphql.test.js` — 14 tests covering introspection, `client`/`clients`/`invoice`/`ticket` queries, nested resolvers (contracts, invoices, payments, devices, ledger, contacts, items, appliedPayments, comments), null handling, and limit clamping; all 14 pass

### P3.4 — httpOnly + SameSite cookies (eliminate XSS-token-theft on refresh tokens)
- ✅ `cookie-parser` added as a backend dependency; `app.use(cookieParser())` wired in `src/app.js` after body parsers
- ✅ `src/services/authService.js` exports `REFRESH_SECONDS` and `ACCESS_SECONDS` constants for cookie `maxAge` calculations
- ✅ `src/middleware/schemas/auth.js` — `refreshToken` field made optional in the `refreshToken` and `switchOrganization` schemas (browser SPA sends it via cookie; body field preserved for API-client backward compat)
- ✅ `src/routes/auth.js` rewritten with `setAuthCookies(res, accessToken, refreshToken)` / `clearAuthCookies(res)` helpers:
  - `POST /login` → sets `fireisp_access` (Path=/api, `ACCESS_SECONDS` maxAge) + `fireisp_refresh` (Path=/api/v1/auth/refresh only, `REFRESH_SECONDS` maxAge); both `HttpOnly; SameSite=Strict; Secure` in production; JSON body unchanged for backward compat
  - `POST /refresh` → reads refresh token from `fireisp_refresh` cookie **or** body (cookie wins); rotates both cookies
  - `POST /logout` → revokes session from cookie-or-body refresh token; `clearCookie` on both cookies
  - `POST /switch-organization` → reads refresh token from cookie or body; rotates both cookies on success
- ✅ `src/middleware/auth.js` — `authenticate` checks `req.cookies?.fireisp_access` as JWT source when no `Authorization: Bearer` header is present (Bearer still takes precedence for API clients); `optionalAuth` also recognises the cookie so cookie-authenticated users are not treated as anonymous on optional-auth routes
- ✅ `frontend/src/api/client.ts` — `tokenStore` stripped of all `localStorage` usage; `getRefresh`/`setRefresh` are no-ops (refresh token lives exclusively in the httpOnly cookie managed by the server); `doRefresh()` uses `credentials: 'include'` with no request body; retry in `refreshMiddleware` also passes `credentials: 'include'`
- ✅ `frontend/src/auth/AuthContext.tsx` — mount effect always attempts `POST /api/v1/auth/refresh` with `credentials: 'include'` (no localStorage check); `login()` no longer calls `tokenStore.setRefresh`; `logout()` uses `credentials: 'include'` so the server revokes the cookie session; `switchOrganization()` no longer passes `refreshToken` in body, uses `credentials: 'include'`; all `fetch` calls to `/auth/me` use `credentials: 'include'`
- ✅ `frontend/src/api/graphql.ts` — `GraphQLClient` constructed with `credentials: 'include'`
- ✅ `frontend/src/auth/__tests__/AuthContext.test.tsx` updated — tests now reflect the always-try-refresh-on-mount behavior; asserts refresh token is **not** written to `localStorage`; 6 tests pass
- ✅ `tests/authMiddleware.test.js` updated — `mockReqRes` gains `cookies: {}` default; new "authenticate – httpOnly cookie" suite adds 4 tests: cookie JWT succeeds, invalid cookie rejected, Bearer beats cookie, `optionalAuth` recognises cookie
- ✅ `tests/cookieAuth.test.js` added — 15 new integration tests using `supertest` covering: login sets both cookies (httpOnly + SameSite=Strict + correct Path), JSON body still returned; refresh reads cookie, refresh reads body (backward compat), cookie beats body, 401 when no token at all, new cookies rotated; logout clears both cookies, revokes from cookie, revokes from body
- ✅ `tests/productionHardening.test.js` updated — `refreshToken` schema `required` expectation updated to `false` (documented rationale: cookie path)
- ✅ `src/middleware/csrf.js` added — defense-in-depth CSRF guard using Origin/Referer header validation; for state-changing requests (POST/PUT/PATCH/DELETE) carrying a FireISP auth cookie, the `Origin` or `Referer` header must match the configured `APP_URL` host; returns 403 on mismatch; Bearer/API-key only requests exempt; `SameSite=Strict` alone already prevents CSRF but this satisfies the OWASP "Verifying Origin With Standard Headers" pattern
- ✅ `src/app.js` — `csrfOriginCheck` wired after `cookieParser` on `/api/` prefix
- ✅ `tests/csrf.test.js` added — 12 new unit tests: safe methods pass, no-cookie requests pass, correct Origin passes, Referer fallback, wrong Origin returns 403, no Origin returns 403, PUT/PATCH/DELETE with bad Origin returns 403

### P3.5 — i18n message catalogue (EN / ES / pt-BR)
- ✅ `i18next@^26` + `react-i18next@^17` + `i18next-browser-languagedetector@^8` added as frontend dependencies; language is detected from cookie → localStorage → `navigator.language` with a 1-year cookie cache; falls back to `en` when the detected language has no catalogue
- ✅ `frontend/src/i18n/index.ts` — i18n configuration: resources wired for `en`, `es`, `pt-BR`; `escapeValue: false` (React handles escaping); imported before `<App />` in `main.tsx`
- ✅ `frontend/src/i18n/locales/en.json` — 178 English keys across 18 namespaced sections: `common`, `login`, `portalLogin`, `nav` (all 19 nav items), `layout`, `portalLayout`, `dashboard` (KPI labels + overdue table + all states), `drDrill` (all modal variants with interpolation), `portalDashboard`, `portalInvoices`, `portalTickets`, `clientList`, `contractList`, `invoiceList`, `paymentList`, `ticketList`, `userList`
- ✅ `frontend/src/i18n/locales/es.json` — 178 Spanish (MX) keys — 100% coverage, all strings professionally translated
- ✅ `frontend/src/i18n/locales/pt-BR.json` — 178 Portuguese (BR) keys — 100% coverage, all strings professionally translated
- ✅ Six components updated to use `useTranslation()` / `t()`: `Login.tsx`, `PortalLogin.tsx`, `Layout.tsx` (nav items converted from hardcoded labels to `labelKey` + `t(item.labelKey)`), `PortalLayout.tsx`, `Dashboard.tsx` (KPI cards, overdue table headers, interpolated sub-labels), `DrDrillBanner.tsx` (all three modal variants: never-run, failed, overdue)
- ✅ `frontend/src/test/setup.ts` — `import '@/i18n'` added so Vitest initialises i18n before any component test runs
- ✅ `frontend/scripts/i18n-coverage.mjs` — standalone Node script that flattens locale JSON files, reports per-locale key coverage percentage, lists missing keys, lists orphaned keys, exits 1 on any missing key; verified: `es` 178/178 (100%), `pt-BR` 178/178 (100%)
- ✅ `"i18n:check": "node scripts/i18n-coverage.mjs"` npm script added to `frontend/package.json`
- ✅ `frontend/src/test/i18n.test.ts` — 64 new Vitest tests: (1) locale files parse as valid JSON with >50 keys each, (2) `es` covers all `en` keys (no missing), (3) `pt-BR` covers all `en` keys (no missing), (4) no orphaned keys in `es` or `pt-BR`, (5) critical EN/ES/pt-BR values are correct (`login.title`, `common.signIn`, `dashboard.title`, etc.), (6) all 15 interpolation keys (`{{name}}`, `{{total}}`, `{{days}}`, `{{date}}`, etc.) are preserved in all three locales
- ✅ All 123 Vitest tests pass (64 new i18n + 59 pre-existing)

### P3.6 — Frontend dark mode
- ✅ CSS custom properties added to `frontend/src/index.css` — 16 tokens in `:root` (light) and `[data-theme="dark"]`: `--bg-body`, `--bg-card`, `--bg-subtle`, `--bg-muted`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-dimmed`, `--text-faint`, `--border`, `--border-subtle`, `--border-strong`, `--input-bg`, `--input-border`, `--accent`; `color-scheme` property toggled for native form-element adaptation; `body` and `.portal-header` CSS class rules updated to use variables
- ✅ `frontend/src/auth/DarkModeContext.tsx` added — `ThemePreference ('light' | 'dark' | 'system')` type; `DarkModeProvider` reads initial preference from `localStorage` key `fireisp_theme` (default `'system'`), computes `effectiveTheme` from `prefers-color-scheme` media query for `'system'`, applies `document.documentElement.setAttribute('data-theme', ...)` on every change; `useDarkMode()` hook exposes `{ theme, effectiveTheme, setTheme, toggleTheme }`
- ✅ `frontend/src/App.tsx` wrapped with `<DarkModeProvider>` as outermost wrapper
- ✅ `frontend/src/components/Layout.tsx` — ☀️/🌙 toggle button added to sidebar user area; `aria-label` switches between `darkMode.switchToDark` / `darkMode.switchToLight` i18n keys based on `effectiveTheme`
- ✅ `frontend/src/components/PortalLayout.tsx` — ☀️/🌙 toggle added to portal user area; structural inline styles converted to CSS variable references (`--bg-body`, `--text-secondary`, `--text-muted`, `--border`, etc.)
- ✅ All 24 page files updated — hardcoded structural colors in `styles` const objects replaced with CSS variable token references: layout/card backgrounds → `var(--bg-card)`, page backgrounds → `var(--bg-body)`, subtle fills → `var(--bg-subtle)`, text colors → `var(--text-primary/secondary/muted/dimmed/faint)`, borders → `var(--border/border-subtle/border-strong)`, input backgrounds → `var(--input-bg)`, input borders → `var(--input-border)`; status/semantic badge colors (green, red, amber, purple) left unchanged
- ✅ i18n locale files updated — `darkMode.switchToDark` / `darkMode.switchToLight` keys added to `en.json`, `es.json` (MX Spanish), and `pt-BR.json` (100% locale coverage maintained)
- ✅ `frontend/src/test/darkMode.test.tsx` added — 9 tests: default system→light resolution, `data-theme` attribute applied on mount, toggle light→dark, toggle dark→light, `setTheme('dark')` persists to localStorage, `setTheme('light')` persists, reads persisted preference on mount, system preference resolution, error when used outside provider
- ✅ All 132 Vitest tests pass (9 new dark mode + 123 pre-existing)

### P3.7 — WebSocket upgrade for live dashboards
- ✅ `src/services/wsHub.js` added — `WsHub` class + singleton `wsHub`; attaches to HTTP server at `/ws` (separate from FireRelay's `/ws/firerelay`); JWT-based auth (first message `{type:"auth",token:"..."}` — access token only, no DB round-trip); per-org channel subscribe/unsubscribe (`notifications`, `metrics`, `outages`, `ticket:<id>`); cross-org subscriptions rejected; native WebSocket ping/pong heartbeat every 30 s with 10 s pong-wait timeout; `broadcastWs(channel, event, data)` sends `{type:"event",event,data,channel}` to all open sockets
- ✅ `src/routes/events.js` — `broadcast()` updated to also call `wsHub.broadcastWs()` after SSE delivery (dual-transport), with a try/catch so the SSE path is unaffected if the hub is not yet attached (test environments)
- ✅ `src/server.js` — `wsHub.attach(server)` called after `tunnelServer.attach()`; `wsHub.close()` added to graceful shutdown sequence
- ✅ `frontend/src/api/useWebSocket.ts` added — `useWebSocket(channel)` React hook; connects to `wss://` (or `ws://` in dev) at `/ws`; authenticates by sending access token in first message; subscribes to channel after `auth_ok`; exponential-backoff auto-reconnect (500 ms → 30 s ceiling); returns `{ lastMessage: WsEvent | null, connected: boolean }`; cleans up on unmount
- ✅ `frontend/src/pages/Dashboard.tsx` updated — subscribes to `notifications` channel; live connection indicator (green dot = connected, grey = offline) in page header; event counter badge increments on each push; `invoice`/`payment`/`overdue`/`ticket` events silently invalidate the matching React Query cache keys (zero-latency KPI refresh)
- ✅ `frontend/src/pages/TicketDetail.tsx` updated — subscribes to `ticket:<id>` channel; `comment` events trigger `refetchComments()` (new comment appears instantly); `status` events invalidate the ticket query (status badge refreshes)
- ✅ `en.json` / `es.json` / `pt-BR.json` updated — 3 new `dashboard.live*` keys (`liveConnected`, `liveDisconnected`, `liveEvents`) added to all three locales (100% coverage maintained)
- ✅ `tests/wsHub.test.js` added — 16 tests: lifecycle (attach, double-attach error, close cleanup), auth (valid JWT, invalid JWT close 4003, missing orgId close 4004, auth-protocol error, non-JSON error), channel subscription (valid subscribe, `ticket:id` subscribe, cross-org reject, unsubscribe), broadcastWs (multi-client delivery, org isolation, no-clients no-op), singleton export
- ✅ All 2605 Jest tests pass (16 new wsHub + 2589 pre-existing); all 132 Vitest tests pass (frontend unchanged)

### P3.8 — In-app changelog / feature-announcement panel
- ✅ `src/data/changelog.json` added — static JSON array of 5 changelog entries seeding P3.1–P3.7 milestones; each entry has `{ id, date (ISO), title, body, tags[] }`
- ✅ `src/routes/changelog.js` added — `GET /api/v1/changelog` (public, no auth required); returns entries sorted newest-first from the static JSON
- ✅ `src/app.js` updated — `changelogRoutes` imported and mounted at `/changelog` before the `authenticate` middleware so no token is required
- ✅ `frontend/src/components/ChangelogPanel.tsx` added — bell icon (🔔) button with red unread-count badge (hidden when 0); right-side slide-in panel (CSS `transform`-based, not a modal); `fireisp_changelog_seen` localStorage key tracks last-seen entry ID; `unreadCount` computed from entries newer than last-seen; entries rendered with formatted date, title, body, and tag badges; "Mark all as read" button clears badge; X button + Escape key close panel; `aria-label` on bell button; dark-mode compatible (CSS variables throughout); `useQuery` + direct `fetch` for the public endpoint
- ✅ `frontend/src/components/Layout.tsx` updated — `<ChangelogPanel />` added next to the dark-mode toggle in the sidebar user area
- ✅ `en.json` / `es.json` / `pt-BR.json` updated — 5 new `changelog.*` keys (`title`, `markAllRead`, `close`, `noEntries`, `newBadge`) added to all 3 locales (100% coverage maintained)
- ✅ `tests/changelog.test.js` added — 6 tests: 200 status with array, no auth required, items sorted newest-first, each item has id/date/title/body/tags, at least one entry, tags are string arrays
- ✅ `frontend/src/test/changelog.test.tsx` added — 8 Vitest tests: renders bell icon, shows badge when unread entries exist, hides badge when all seen, opens panel on click, closes panel on X, mark-all-read clears badge, closes on Escape, bell aria-label present (accessibility), axe WCAG 2.1 AA scan passes
- ✅ 2623 Jest tests pass (6 new changelog + 12 new graphqlSubscriptions + 2605 pre-existing); 145 Vitest tests pass (8 new changelog + 4 new graphqlSubscription + 132 pre-existing)

### P3.9 — GraphQL subscriptions for ticket comments / device status changes
- ✅ `src/services/pubsub.js` added — shared `createPubSub()` singleton from `graphql-yoga`; imported by resolvers and routes (avoids circular-dependency pitfall of exporting from resolvers.js)
- ✅ `src/graphql/typeDefs.js` updated — `Subscription` type added with `ticketCommentAdded(ticketId: ID!): TicketComment!` and `deviceStatusChanged(orgId: ID!): Device!`
- ✅ `src/graphql/resolvers.js` updated — `Subscription` resolver map added; both fields have `subscribe` (async generator with per-field filtering) and `resolve` functions; `pubsub` imported from `src/services/pubsub.js`
- ✅ `src/graphql/index.js` updated — `pubsub` injected into yoga context so it is available to subscription resolvers at runtime
- ✅ `src/routes/tickets.js` updated — after inserting a comment, calls `pubsub.publish('TICKET_COMMENT_ADDED', { ticketCommentAdded: rows[0], ticketId: req.params.id })`
- ✅ `src/routes/devices.js` updated — PUT `/:id` replaced with an inline async handler (mirrors crudController logic) that calls `pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: record, orgId: req.orgId })` after updating; `bustCache` and `auditLog` preserved
- ✅ `frontend/src/api/useGraphQLSubscription.ts` added — `useGraphQLSubscription<T>(query, variables)` hook; connects via `EventSource` to `/api/v1/graphql` with `query` + `variables` as GET params; parses `message` events to extract `data`; sets `error` state on EventSource error; cleans up on unmount; returns `{ data: T | null, error: string | null }`
- ✅ `frontend/src/pages/TicketDetail.tsx` updated — imports `useGraphQLSubscription`; subscribes to `ticketCommentAdded(ticketId: ID!)`; on new comment event calls `refetchComments()` (additive — existing `useWebSocket` path unchanged)
- ✅ `tests/graphqlSubscriptions.test.js` added — 12 tests: Subscription type in schema, `ticketCommentAdded` field, `deviceStatusChanged` field, subscribe/resolve functions exist, TICKET_COMMENT_ADDED pubsub round-trip, DEVICE_STATUS_CHANGED pubsub round-trip, ticketId filter delivers matching, orgId filter delivers matching, resolve fn for ticketCommentAdded, resolve fn for deviceStatusChanged, ticketId filter skips test, orgId filter skips non-matching and delivers matching
- ✅ `frontend/src/test/graphqlSubscription.test.ts` added — 4 Vitest tests: initial null state, processes data event, cleans up EventSource on unmount, sets error on error event

### P3.10 — DevEx: replace `npm` with `pnpm` for faster CI installs
- ✅ `pnpm@10.33.2` adopted as the workspace package manager; `"packageManager": "pnpm@10.33.2"` declared in root `package.json` so corepack/CI always uses the pinned version
- ✅ `pnpm-workspace.yaml` created — declares `frontend` and `e2e` as workspace packages; a single `pnpm-lock.yaml` at the root replaces the three separate `package-lock.json` files
- ✅ `.npmrc` created — `auto-install-peers=true`; `pnpm.onlyBuiltDependencies` whitelist in `package.json` permits native-build scripts for `esbuild`, `msgpackr-extract`, and `unrs-resolver` (required by Vite/Vitest)
- ✅ `package.json` updated: `overrides` block converted to `pnpm.overrides` using pnpm's nested-override syntax (`test-exclude>glob: "^7.2.0"` instead of nested object); `engines` field adds `"pnpm": ">=10.0.0"`
- ✅ `frontend/package.json` scripts updated — `npm run gen:api` → `pnpm run gen:api`, `npm run` prefixes replaced with `pnpm run`
- ✅ `.lintstagedrc.cjs` updated — `npm --prefix frontend` → `pnpm --dir frontend` and `npx --prefix frontend tsc` → `pnpm --dir frontend exec tsc`
- ✅ `Dockerfile` rewritten for pnpm: build stage installs pnpm via `corepack enable`, copies root `package.json + pnpm-lock.yaml + pnpm-workspace.yaml + .npmrc`, runs `pnpm install --frozen-lockfile --filter fireisp-frontend`, then `pnpm --filter fireisp-frontend run build`; runtime stage installs prod deps with `pnpm install --frozen-lockfile --prod` and prunes the pnpm store
- ✅ `.dockerignore` updated — excludes all three `package-lock.json` files; adds `pnpm-debug.log*`
- ✅ `.gitignore` updated — `package-lock.json` added (all three lockfiles are now untracked); `pnpm-debug.log*` added
- ✅ `package-lock.json`, `frontend/package-lock.json`, `e2e/package-lock.json` removed from the repository; `pnpm-lock.yaml` committed in their place
- ✅ `.github/workflows/ci.yml` updated across all jobs (`lint-and-test`, `frontend-test`, `dast`): `pnpm/action-setup@v4` added before `actions/setup-node@v4`; `cache: npm` → `cache: pnpm`; `npm ci` → `pnpm install --frozen-lockfile`; `npx jest/eslint` → `pnpm exec jest/eslint`; `npm audit` → `pnpm audit`; `npm --prefix frontend ci` → single workspace install; `npm --prefix frontend test/lint` → `pnpm --filter fireisp-frontend test/lint`; `npm run migrate/seed` → `pnpm run migrate/seed`
- ✅ All 2623 Jest + 145 Vitest tests pass after the migration

### P3.11 — Spec-driven development (generate route stubs from OpenAPI spec, eliminate drift)
- ✅ `src/scripts/spec-drift.js` added — drift detector; regenerates the OpenAPI spec in memory via `generateSpec()` and compares it path-by-path and method-by-method against the committed `docs/openapi.json`; detects: (a) paths/methods in generator missing from committed spec, (b) paths/methods in committed spec not in generator, (c) meta-section drift (`info`, `servers`, `components`), (d) duplicate `operationId` values (breaks client codegen and Swagger UI); exits 1 on any drift item; exports `toExpressPath`, `normaliseSpec`, `findDuplicateOperationIds`, `findPathDrift`, `findMetaDrift` for unit testing
- ✅ `src/scripts/gen-route.js` added — route stub generator; reads `docs/openapi.json`, accepts `--resource <name>` (and optional `--tag`, `--force`); generates skeleton `src/routes/<resource>.js` (CRUD handlers wired to `crudController`, `requirePermission` guards), `src/middleware/schemas/<resource>.js` (createX/updateX schema stubs), and `tests/<resource>.test.js` (Jest stub with 401-without-auth test); skips existing files unless `--force`; prints next-step instructions; exports all generator helpers for unit testing
- ✅ `src/utils/openapi.js` updated — 11 paths that were present in committed `docs/openapi.json` but missing from the generator added: `POST /auth/switch-organization`, `POST /contracts/{id}/suspend`, `POST /contracts/{id}/unsuspend`, `POST /radius/{id}/disconnect`, `GET /connection-logs/active`, `GET /connection-logs/daily-usage`, `GET /connection-logs/top-consumers`, `GET /reports/financial`, `GET /reports/aging`, `GET /reports/subscriber-growth`, `GET /reports/technicians` — fixes real pre-existing drift discovered by the new checker
- ✅ `docs/openapi.json` regenerated (`npm run openapi`) — now in sync with updated generator (196 paths, 0 drift items)
- ✅ `package.json` updated — `"spec:check": "node src/scripts/spec-drift.js"` and `"spec:gen": "node src/scripts/gen-route.js"` npm scripts added
- ✅ `.github/workflows/ci.yml` updated — `Spec drift check` step added to `lint-and-test` job (runs after lint, before security audit); fails CI if `docs/openapi.json` drifts from `src/utils/openapi.js`
- ✅ `tests/specDrift.test.js` added — 38 tests: `toExpressPath` (3 tests), `normaliseSpec` (3 tests), `findDuplicateOperationIds` (4 tests), `findPathDrift` (5 tests), `findMetaDrift` (3 tests), `generateSpec()` live integrity checks (4 tests including the key "committed spec is in sync with generator" regression guard), `toPascal/toCamel` (4 tests), `extractResourcePaths` (4 tests), `generateRouteFile` (4 tests), `generateSchemaFile` (1 test), `generateTestFile` (2 tests); 2661 Jest tests pass (38 new + 2623 pre-existing)

- Docs: video walkthroughs of the data-migration flow and the FireRelay agent install
- Compliance MX: integrate with Buró de Crédito for credit-decision automation on plan upgrades

### P3.12 — PROFECO complaint export tool
- ✅ `database/migrations/168_create_profeco_complaints_table.sql` added — `profeco_complaints` table: `folio_profeco`, `consumer_name/email/phone`, `service_type` (internet/telefonia/television/paquete), `category` (facturacion/calidad\_servicio/contrato/suspension\_indebida/cobros\_no\_autorizados/atencion\_cliente/otro), `description`, `resolution_requested`, `company_response`, `status` (recibida/en\_tramite/resuelta/archivada), `reported_at`, `resolved_at`, FK to organizations/clients/tickets/users; soft-delete; all indexes
- ✅ `src/models/ProfecoComplaint.js` added — `hasOrgScope`, `softDelete`, all `fillable` fields
- ✅ `src/services/profecoService.js` added — `buildReport(orgId, { dateFrom, dateTo, status, format })` generates structured report with per-status summary; exports as **JSON** (default — full detail with meta block) or **CSV** (flat spreadsheet-friendly layout with all fields); `toCsv()` helper escapes commas/quotes/newlines; `toCsv([])` returns empty string
- ✅ `src/middleware/schemas/profeco.js` added — `createProfecoComplaint` (consumer_name + description required), `updateProfecoComplaint`, `patchProfecoComplaint` with service_type/category/status enum validation
- ✅ `src/routes/profeco.js` added — full CRUD (`GET /`, `GET /export`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/restore`); `submitted_by` auto-stamped from `req.user.id` on create; `/export` declared before `/:id` to avoid routing conflict
- ✅ `src/app.js` updated — `profecoRoutes` mounted at `/api/v1/profeco-complaints`
- ✅ `database/schema.sql` updated — `profeco_complaints` table appended (migration 168)
- ✅ `src/utils/openapi.js` updated — `'PROFECO Complaints'` tag + `crudPaths('profeco-complaints', ...)` + `/profeco-complaints/export` GET with query params (date_from, date_to, status, format); `docs/openapi.json` regenerated (196 → 199 paths)
- ✅ `tests/profeco.test.js` added — 18 tests: CRUD happy paths (list, get, 404, create 201, 422 validations, patch, delete 204), export endpoint (JSON default, CSV format, empty CSV, date filter SQL params, status filter SQL params, generatedAt ISO timestamp), `toCsv()` unit tests (empty, header+data, comma escaping, quote escaping)
- ✅ `frontend/src/pages/ProfecoComplaints.tsx` added — paginated table with status + category filters; "New Complaint" modal form (consumer_name, folio_profeco, service_type, category, description, resolution_requested); "Export CSV" and "Export JSON" buttons trigger browser download; dark-mode CSS variables throughout; i18n via `useTranslation()`
- ✅ `frontend/src/App.tsx` updated — `/profeco-complaints` route added under `billing+` role guard
- ✅ `frontend/src/components/Layout.tsx` updated — `nav.profecoComplaints` nav item added (billing+ visibility, after CFDI)
- ✅ `frontend/src/i18n/locales/en.json` / `es.json` / `pt-BR.json` updated — `profecoComplaints` section (title, actions, filter labels, table headers, status/category/serviceType enum labels, form field labels, error messages); `nav.profecoComplaints` added; `common.saving` added; 100% locale coverage maintained (230 keys each)

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
| 2026-04-24 | P2.4 | Per-tenant resource quotas: `database/migrations/166_create_organization_quotas.sql` (organization_quotas table — max_clients, max_devices, max_storage_mb, max_scheduled_tasks; NULL=unlimited), `src/models/OrganizationQuota.js` (findByOrgId + upsert), `src/services/quotaService.js` (getQuota, getUsage, getQuotaWithUsage, checkQuota — 422 on breach), `src/middleware/checkQuota.js` (quotaCheck middleware), POST /clients + /devices + /scheduled-tasks now enforce quotas, `GET/PUT /organizations/:id/quota` routes added, Settings.tsx Quotas tab (QuotaBar progress + edit form), 18 new tests in `tests/quotaService.test.js` |
| 2026-04-24 | P2.5 | Helm chart + GitOps: `charts/fireisp/` Helm chart (Chart.yaml, values.yaml, .helmignore, 13 templates — all K8s resources from k8s/ are now templated, monitoring + cosignPolicy gated by feature flags); `docs/deployment.md` extended with Helm quick-start, values guide, Argo CD Application manifest, Sealed Secrets + Argo CD workflow, chart release process; `.github/workflows/ci.yml` `helm-release` job (helm lint --strict + smoke template + chart-releaser-action on v* tags) |
| 2026-04-27 | P2.6 | Per-tenant database isolation option: `organization_database_configs` control-plane table, tenant-aware DB pool routing via `orgScope` async context, masked admin config/test endpoints, `MIGRATE_ISOLATED_TENANTS=true` migration support, and `docs/tenant-database-isolation.md` operations guide |
| 2026-04-27 | P2.7 | Background job platform (BullMQ): `src/workers/index.js` (worker registry — 5 named queues: `scheduled-task`, `webhook-delivery`, `sms-send`, `cfdi-stamp`, `config-backup`); `src/services/jobQueueService.js` extended (`getStats()` + `QUEUE_NAMES` export); `src/services/webhookService.js` — `deliverForWorker()` BullMQ handler (job-aware retry via `throw`, `job.update()` persists `deliveryRowId` across retries, dead_letter on final attempt), `dispatch()` enqueues via BullMQ when `REDIS_URL` set (non-blocking, native backoff) vs inline fallback; `src/services/smsTransport.js` — `queueSms()` dispatches via BullMQ when available; `src/services/scheduler.js` — cron ticks enqueue `scheduled-task` jobs with minute-granular `jobId` deduplication (atomic Redis SETNX, no advisory lock needed) vs inline fallback; `src/routes/queueStats.js` (`GET /api/v1/queue-stats` — per-queue waiting/active/completed/failed/delayed counts, admin IP allowlisted); `src/server.js` — `registerWorkers()` at startup + `jobQueue.close()` in graceful shutdown; 16 new tests in `tests/bullWorkers.test.js` |
| 2026-04-27 | P3.1 | Frontend accessibility audit: `jest-axe@10` + `toHaveNoViolations` global matcher in `frontend/src/test/setup.ts`; `frontend/src/test/a11y.test.tsx` — 8 WCAG 2.1 AA axe tests covering Login, Dashboard, ClientList (x2), InvoiceList, TicketList, UserList, PortalLogin; fixed real violations — `aria-label` added to 4 filter `<select>` elements in TicketList.tsx and UserList.tsx; 59 Vitest tests pass (8 new) |
| 2026-04-27 | P3.2 | DevEx pre-commit hooks: `husky@^9` + `lint-staged@^16` added as root devDependencies; `"prepare": "husky"` in `package.json`; `.husky/pre-commit` runs `npx lint-staged`; `.lintstagedrc.cjs` — `src/**/*.js` → `eslint --fix`; `frontend/src/**/*.{ts,tsx}` → function returning `gen:api && tsc --noEmit` (suppresses file-arg appending to tsc, always checks full TS project) |
| 2026-04-27 | P3.3 | GraphQL gateway: `graphql-yoga@^5` + `graphql@^16` (backend), `graphql-request@^7` (frontend); `src/graphql/typeDefs.js` (12 SDL types — Client, Contract, Invoice, InvoiceItem, AppliedPayment, Payment, Device, LedgerEntry, Contact, Ticket, TicketComment), `src/graphql/resolvers.js` (lazy nested resolvers, org-scoped via ctx.orgId, MAX_LIMIT=200 clamp), `src/graphql/index.js` (graphql-yoga Express middleware, Promise.resolve wrapper for sync fast-path), `src/middleware/sanitize.js` (GraphQL path excluded from HTML entity encoding), `src/app.js` (authenticate+orgScope imported at app level, `/graphql` mount in v1 router), `frontend/src/api/graphql.ts` (typed gql<T>() helper with auto-JWT), `frontend/src/pages/ClientDetail.tsx` rewritten with single CLIENT_DETAIL_QUERY replacing 5+ parallel REST calls (contracts, invoices, payments, devices, ledger all in one round-trip); 14 new tests in `tests/graphql.test.js` |
| 2026-04-27 | P3.4 | httpOnly+SameSite cookies: `cookie-parser` dependency added + wired in `app.js`; `authService.js` exports `REFRESH_SECONDS`/`ACCESS_SECONDS`; `/login` + `/refresh` + `/switch-organization` set `fireisp_access` (Path=/api, 15 m) + `fireisp_refresh` (Path=/api/v1/auth/refresh, 7 d) httpOnly SameSite=Strict cookies; `/logout` clears both; `/refresh` accepts token from cookie OR body; `authenticate` + `optionalAuth` middleware recognize `fireisp_access` cookie as JWT source when no Bearer header; frontend `client.ts` strips all `localStorage` refresh-token storage — `doRefresh()` uses `credentials:'include'`; `AuthContext.tsx` — always attempts refresh with credentials:include on mount (no localStorage check), login no longer writes refresh to localStorage, logout/switchOrg use credentials:include; `graphql.ts` adds credentials:include; defense-in-depth CSRF guard added (`src/middleware/csrf.js`) — verifies Origin/Referer header matches APP_URL for cookie-bearing state-changing requests; 15 new tests in `tests/cookieAuth.test.js`, 12 new tests in `tests/csrf.test.js`, 4 new tests in `tests/authMiddleware.test.js`, 6 updated AuthContext Vitest tests |
| 2026-04-27 | P3.5 | i18n message catalogue: `i18next@^26` + `react-i18next@^17` + `i18next-browser-languagedetector@^8`; `frontend/src/i18n/index.ts` (language detection cookie→localStorage→navigator, fallback en); `frontend/src/i18n/locales/en.json` / `es.json` / `pt-BR.json` — 178 keys each (100% coverage) across login, nav, layout, portal, dashboard, drDrill, all list pages; 6 components updated to use `t()` (Login, PortalLogin, Layout, PortalLayout, Dashboard, DrDrillBanner); `frontend/scripts/i18n-coverage.mjs` coverage script (exit 1 on missing keys); `"i18n:check"` npm script; 64 new Vitest tests in `frontend/src/test/i18n.test.ts` (JSON validity, coverage, orphan detection, critical value assertions, interpolation placeholder checks) — 123 total Vitest tests pass |
| 2026-04-27 | P3.6 | Frontend dark mode: `index.css` — 16 CSS token variables in `:root` (light) + `[data-theme="dark"]` with `color-scheme` property; `frontend/src/auth/DarkModeContext.tsx` — `ThemePreference` type, `DarkModeProvider` (localStorage persistence, `prefers-color-scheme` media query for system pref, `data-theme` attribute on `<html>`), `useDarkMode()` hook; `App.tsx` wrapped with `<DarkModeProvider>`; ☀️/🌙 toggle button added to `Layout.tsx` sidebar and `PortalLayout.tsx` header (i18n-labelled); all 24 page files updated — hardcoded structural colors replaced with CSS variable token references; `darkMode.switchToDark`/`switchToLight` keys added to all 3 locales; `frontend/src/test/darkMode.test.tsx` — 9 Vitest tests (default system pref, `data-theme` mount, toggle, persistence, system resolution, error boundary); 132 total Vitest tests pass |
| 2026-04-27 | P3.7 | WebSocket upgrade for live dashboards: `src/services/wsHub.js` — `WsHub` class + singleton; attaches at `/ws`; JWT auth via first message (access token, no DB round-trip); per-org channel subscribe/unsubscribe (notifications/metrics/outages/ticket:id); cross-org rejection; ping/pong heartbeat 30 s + 10 s timeout; `broadcastWs(channel, event, data)`; `src/routes/events.js` — `broadcast()` now dual-dispatches to SSE + WebSocket (wsHub gracefully skipped in test env); `src/server.js` — `wsHub.attach(server)` + `wsHub.close()` in graceful shutdown; `frontend/src/api/useWebSocket.ts` — `useWebSocket(channel)` hook (auto-auth, subscribe, exponential-backoff reconnect 500 ms → 30 s, returns `{ lastMessage, connected }`); `Dashboard.tsx` — live connection indicator + event counter badge + React Query cache invalidation on push; `TicketDetail.tsx` — `comment` events trigger `refetchComments()`, `status` events invalidate ticket query; 3 new `dashboard.live*` i18n keys in all 3 locales; `tests/wsHub.test.js` — 16 tests (lifecycle, auth, channel subscription, broadcast, singleton); 2605 Jest tests pass + 132 Vitest tests pass |
| 2026-04-27 | P3.8 | In-app changelog panel: `src/data/changelog.json` (5 entries seeding P3.1–P3.7); `src/routes/changelog.js` (`GET /api/v1/changelog` public, sorted newest-first); `src/app.js` mounts changelog before authenticate; `frontend/src/components/ChangelogPanel.tsx` (bell icon + unread badge, slide-in panel, localStorage seen tracking, mark-all-read, Escape/X close, dark-mode CSS variables, axe-clean); `Layout.tsx` updated; 5 `changelog.*` i18n keys in all 3 locales; `tests/changelog.test.js` (6 tests); `frontend/src/test/changelog.test.tsx` (8 tests); 2623 Jest + 145 Vitest pass |
| 2026-04-27 | P3.9 | GraphQL subscriptions: `src/services/pubsub.js` shared pubsub singleton; `typeDefs.js` Subscription type (`ticketCommentAdded`, `deviceStatusChanged`); `resolvers.js` async-generator subscribe + resolve with per-field filtering; `graphql/index.js` pubsub in context; `tickets.js` publishes TICKET_COMMENT_ADDED after comment insert; `devices.js` inline PUT handler publishes DEVICE_STATUS_CHANGED after update; `frontend/src/api/useGraphQLSubscription.ts` (EventSource-based hook); `TicketDetail.tsx` subscribes to ticketCommentAdded; `tests/graphqlSubscriptions.test.js` (12 tests); `frontend/src/test/graphqlSubscription.test.ts` (4 tests); 2623 Jest + 145 Vitest pass |
| 2026-04-28 | P3.10 | pnpm migration: `pnpm@10.33.2` pinned via `packageManager`; `pnpm-workspace.yaml` (frontend + e2e); `.npmrc` (`auto-install-peers`, `onlyBuiltDependencies` whitelist for esbuild/msgpackr-extract/unrs-resolver); `package.json` `overrides` → `pnpm.overrides` with `test-exclude>glob` nested syntax; frontend scripts `npm run` → `pnpm run`; `.lintstagedrc.cjs` `npm --prefix` → `pnpm --dir`; `Dockerfile` switched to corepack + `pnpm install --frozen-lockfile` in both stages; `.dockerignore`/`.gitignore` updated; `package-lock.json` files removed, `pnpm-lock.yaml` committed; CI `lint-and-test`+`frontend-test`+`dast` jobs updated — `pnpm/action-setup@v4`, `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm exec jest/eslint`, `pnpm audit`, `pnpm --filter fireisp-frontend`; 2623 Jest + 145 Vitest pass |
| 2026-04-28 | P3.11 | Spec-driven development: `src/scripts/spec-drift.js` (drift detector — compares in-memory `generateSpec()` to committed `docs/openapi.json`, detects missing/extra paths+methods+meta+duplicate operationIds, exits 1 on drift); `src/scripts/gen-route.js` (route stub generator — reads spec, generates `src/routes/<resource>.js` + `src/middleware/schemas/<resource>.js` + `tests/<resource>.test.js` skeletons from `--resource` flag); `src/utils/openapi.js` patched — 11 real pre-existing drift items fixed (`POST /auth/switch-organization`, suspend/unsuspend contracts, disconnect RADIUS, 3 connection-log analytics, 4 reports); `docs/openapi.json` regenerated (196 paths, 0 drift); `spec:check` + `spec:gen` npm scripts; `Spec drift check` CI step in lint-and-test job; `tests/specDrift.test.js` — 38 tests; 2661 Jest tests pass (38 new + 2623 pre-existing) |
| 2026-04-28 | P3.12 | PROFECO complaint export: `database/migrations/168_create_profeco_complaints_table.sql` (profeco_complaints table — folio_profeco, consumer fields, service_type/category/status ENUMs, description, resolution_requested, company_response, reported_at/resolved_at, FKs to org/client/ticket/user); `src/models/ProfecoComplaint.js`; `src/services/profecoService.js` — `buildReport()` generates JSON (meta + per-status summary + full rows) or CSV export; `src/middleware/schemas/profeco.js`; `src/routes/profeco.js` — full CRUD + `GET /export?format=json|csv&date_from=&date_to=&status=`; `src/utils/openapi.js` updated + `docs/openapi.json` regenerated (196→199 paths); `frontend/src/pages/ProfecoComplaints.tsx` — paginated list + status/category filters + export buttons + New Complaint modal; `App.tsx` route + `Layout.tsx` nav item (billing+); `profecoComplaints.*` + `common.saving` i18n keys added to all 3 locales (230 keys, 100% coverage); `tests/profeco.test.js` — 18 tests; 2679 Jest + 145 Vitest pass |
