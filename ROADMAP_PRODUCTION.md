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
- ❌ `organization_id INT UNSIGNED` references `organizations.id BIGINT UNSIGNED` → `ERROR 3780 (HY000) … fk_snmp_traps_org … incompatible`
- Same defect for `device_id` (devices.id is BIGINT UNSIGNED) and likely `acknowledged_by` (users.id is BIGINT UNSIGNED)
- Fix: change all three columns in `163_create_snmp_traps_table.sql` to `BIGINT UNSIGNED`; sync `database/schema.sql`
- Add a CI assertion that **every FK column matches the type of its referenced PK** so this class of bug is impossible to merge

### P0.2 — Fix migration 028 (`snmp_rollup_events`) `DELIMITER` parsing
- ❌ `DELIMITER $$` is a `mysql` client directive, not server SQL — the JS migrate runner (`src/scripts/migrate.js`) executes it via mysql2 prepared statements which return `ER_PARSE_ERROR`
- This means the migration smoke test job has been broken since migration 028 landed — the database-tests CI job currently passes only because it pipes the file through the `mysql` client (which understands DELIMITER), but `migration-smoke-test` (which uses the Node runner) is the one failing
- Fix options (pick one):
  - (a) Teach `src/scripts/migrate.js` to split on `DELIMITER` directives before sending to mysql2, or
  - (b) Rewrite migration 028 to emit one `CREATE PROCEDURE … END` statement per `query()` call without DELIMITER directives, or
  - (c) Document and enforce that procedure/event migrations must use the `--via-mysql-client` runner path
- Add a regression test that runs `npm run migrate` on an empty DB in CI and asserts exit code 0

### P0.3 — Fix the `LIMIT ?/OFFSET ?` paginated-list regression
- Documented in `ROADMAP.md` changelog 2026-04-22 ("first run surfaced a `mysqld_stmt_execute` regression on every paginated list endpoint") and confirmed at `src/models/BaseModel.js:101`
- This affects **every** `GET /api/v1/<resource>?page=&limit=` route — i.e. the entire admin UI
- Fix: validate `limit`/`offset` as positive integers in JS and inline them into the SQL string (they are not user-controllable identifiers once validated), or switch to mysql2 `query()` (text protocol) for these two parameters only
- Re-run the M4.1 autocannon load test and update `docs/load-testing.md` with the post-fix numbers

### P0.4 — Reconcile `database/schema.sql` with migrations 158–163
- The CI step "Verify migrations produce expected table count" emits a *warning* (not an error) when counts disagree — flip it to a hard failure once P0.1 lands
- Manually diff `schema.sql` against a fresh `npm run migrate` dump and commit the delta

### P0.5 — Make CI on `main` green and keep it green
- All four items above must land before this is achievable
- Add **branch protection** on `main` requiring CI to pass before merge (currently main has been merging red runs for ≥5 runs in a row)

---

## P1 — Must-Have Before First Paying Tenant

### P1.1 — Frontend automated tests
- Add Vitest + React Testing Library to `/frontend`; replace the placeholder `test` script with a real runner
- Cover at minimum: AuthContext (silent refresh on 401, role-based routing), each MVP page's happy path (Dashboard, Clients, Contracts, Invoices, Payments, Tickets, Devices, Users, Portal*) — load fixture, assert key elements render
- Wire `npm --prefix frontend test` into `.github/workflows/ci.yml`
- Target: 60% line coverage on `frontend/src/pages` and `frontend/src/auth`

### P1.2 — End-to-end (browser) smoke test
- Add Playwright. One scenario: log in → create client → assign plan → generate invoice → record payment → open ticket → log out
- Run against `docker-compose.test.yml` in CI on every PR

### P1.3 — Documented disaster-recovery drill
- Take a backup, destroy the DB, restore from the backup, verify referential integrity and row counts. Document the steps and the timing in `docs/dr-drill.md`
- Re-run quarterly; record the run date in the doc

### P1.4 — Production secrets management
- `.env.example` has 36 vars but the production story is "set them somehow". Document the supported options: K8s Secret + Sealed-Secrets, AWS/GCP Secret Manager, HashiCorp Vault. Pick one as the recommended default and ship a manifest in `/k8s/`
- Audit: no secrets ever logged (Pino redact list), no secrets ever returned by `/health?detail=true`

### P1.5 — Container image hardening + SBOM
- Convert `Dockerfile` to multi-stage if it isn't already, run as non-root user, drop all Linux capabilities
- Generate an SBOM on every build (`docker buildx … --sbom=true` or `syft`) and attach it as a build artifact
- Add Trivy (or Grype) container scan as a CI job; fail on `HIGH` or `CRITICAL` CVEs
- Sign the image with cosign and verify the signature in K8s admission

### P1.6 — Pre-production load + soak test
- Re-run the M4.1 autocannon load test against the production docker-compose stack (not just the dev API) **after** P0.3 lands
- Add a 24-hour soak test (low rate, continuous) to catch memory leaks, FD leaks, connection-pool exhaustion
- Record the results, set a regression budget, run on every release candidate

### P1.7 — Privacy & data-subject compliance
- Mexico: LFPDPPP — document the lawful basis for each PII column, add a "data subject access request" admin tool that exports a single client's PII as JSON
- EU customers (if any): GDPR DSAR + erasure flow on top of the existing soft-delete
- Add `/docs/privacy.md` listing every PII field, retention period, and erasure path

### P1.8 — Observability: SLOs and alerting
- Define and document SLOs in `/docs/slo.md`: API availability ≥ 99.9% / month, p99 latency ≤ 500ms for read endpoints, RADIUS auth success ≥ 99.95%
- Author Prometheus alerting rules backed by the SLOs (burn-rate alerts, not threshold alerts)
- Wire alerts to PagerDuty/Opsgenie (or email-only if single-operator) — document the on-call rotation

### P1.9 — Incident response runbook
- Extend `docs/runbook.md` with: severity matrix (SEV1–SEV4), declaration criteria, comms templates (status page, customer email), post-mortem template, escalation paths
- Add a "what to do when X is on fire" section per SEV1 scenario: DB down, RADIUS down, payment gateway down, mass suspension event, leaked credentials

---

## P2 — Must-Have Before Scaling Beyond a Single Tenant Org

### P2.1 — SSO / SAML / OIDC for admin users
- Larger ISPs will want to bring their own IdP (Okta, Azure AD, Google Workspace). Add SAML 2.0 + OIDC (passport-saml + openid-client) gated by a feature flag per organization
- Map IdP groups to FireISP roles via a config table

### P2.2 — Penetration test + remediation
- Engage a third party (or run OWASP ZAP DAST in CI as a starting point) against a staging instance
- Track findings as P0/P1/P2 in this file; close all P0/P1 before public launch

### P2.3 — Multi-tenant data isolation audit
- Add an **automated** test that, for every org-scoped table, asserts that an authenticated user from org A *cannot* read/write rows belonging to org B via every list/get/update/delete endpoint
- This is the single most expensive class of bug to discover in production. A property-based test using fast-check is ideal here.

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
