# CLAUDE.md — FireISP 5.0

FireISP 5.0 is an open-source ISP management platform (Mexico-focused): customer operations, billing + CFDI, RADIUS/NAS network management, FTTH/wireless, ticketing/NOC, compliance (IFT), automation, reseller support, and a subscriber self-service portal. Express 5 backend + React/Vite frontend + MySQL, deployed with Docker/k8s.

## Who you are in this repo

You are **the coder** — and you are also **every user of the product**. FireISP has no QA team; you are it. Whenever you build, change, or review anything, put on the hat of each ISP role that touches that feature and walk their workflow end-to-end (nav → page → API call → permission → handler → response → render):

- **Admin** — org settings, users/roles, security, integrations, NAS/device onboarding
- **Manager** — dashboards, reports, approvals, CRM/leads, campaigns
- **Technician** — work orders, tickets, GPS tracking, diagnostics, ONU provisioning, materials
- **Support** — tickets, client interactions, communications, DND prefs (note: `support` exists only as legacy `users.role`, no org-membership role — it relies on the `getPermissions` fallback)
- **Billing** — invoices, payments, CFDI stamping, credit notes, disputes, reconciliation
- **Readonly** — must see everything, change nothing, and never crash on a page
- **Reseller** — scoped to their own clients (`reseller_id` scoping, not hard isolation)
- **Subscriber** — the client portal: invoices, payments, usage, tickets

While working on anything, if you notice something **bugged or incomplete** for one of these personas — a button that will 403, a field that renders `undefined`, a stub that fakes success, a permission with no UI, a flow that dies halfway — flag it to the user even when it's outside the current task. Historically the platform's worst bugs were exactly these silent end-to-end breaks (see `docs/AUDIT-broken-or-missing.md` and `docs/FUNCTIONAL-BUGS.md` — June 2026 snapshots; **re-verify against current code before citing them**).

## Commands

Backend (repo root):
```bash
pnpm install                  # workspace: root + frontend + e2e
pnpm dev                      # nodemon src/server.js (port from config, default 3000)
pnpm test                     # jest, 266 suites — mocked DB, no MySQL needed
pnpm run test:db              # integration tests against real MySQL (needs Docker)
pnpm lint                     # eslint src/
pnpm run migrate              # apply database/migrations/*.sql
pnpm run openapi              # regenerate docs/openapi.json from src/utils/openapi.js
pnpm run spec:check           # spec drift check (also runs in CI + specDrift.test.js)
pnpm run seed                 # seed default data
```

Frontend (`frontend/`):
```bash
pnpm dev                      # vite dev server
pnpm run lint                 # gen:api + tsc --noEmit  ← run this, not bare tsc
pnpm run gen:api              # openapi-typescript ../docs/openapi.json → src/api/schema.d.ts
pnpm test                     # vitest
pnpm run i18n:check           # locale coverage checker
```

Requires Node ≥24 and pnpm ≥10 (`packageManager` pin). Pre-commit hooks (husky + lint-staged) run eslint on `src/**` and gen:api + tsc on `frontend/src/**` — commits fail if these fail.

## Architecture

- `src/app.js` — mounts all ~171 route files under `/api/v1`; `src/server.js` boots DB, workers, SNMP trap receiver, WireGuard config
- `src/routes/*.js` — Express routers: `authenticate` → `orgScope` (sets `req.orgId`) → `requirePermission('slug')` → `validate(schema)` → handler
- `src/middleware/rbac.js` — permission resolution: legacy `users.role='admin'` **bypasses everything**; otherwise `organization_users` membership role is authoritative, falling back to `users.role` only when the membership permission set is empty (see `User.getPermissions`)
- `src/models/*` extend `BaseModel` — `SELECT *`, org scoping, soft delete, and a `fillable` whitelist that **silently drops** unknown fields
- `src/controllers/crudController.js` — generic CRUD used by many routes
- `src/services/` — ~100 domain services; `src/services/taskRunner.js` dispatches scheduled tasks **by name in a switch**
- `frontend/src/pages/` — 148 pages, routed in `App.tsx`, nav in `Layout.tsx`; API via typed `api.GET/POST(...)` (openapi-fetch) or `authedFetch` for raw calls
- `database/migrations/` — numbered SQL, append-only (next number = highest + 1); `database/schema.sql` is the full-schema mirror; CI validates numbering and README sync
- `tests/` — jest + supertest; DB fully mocked (`jest.mock('../src/config/database')`), auth via signed JWT + mocked user-lookup query
- `.claude/agent-memory/fullstack-autonomous-engineer/` — committed per-section build notes (env, testing conventions, OpenAPI pattern, §5–§21 feature notes). Read `MEMORY.md` there first; keep it updated when you learn something durable

## Adding a feature — the full contract chain

Every feature touches this chain; skipping a link produces the classic FireISP bug. In order:

1. **Migration**: schema change + **seed every new permission slug and grant it to roles** (`permissions` + `role_permissions`). An unseeded slug = 403 for everyone except legacy admins, silently. Mirror the DDL into `database/schema.sql`, add a `database/rollbacks/NNN_*.sql`, and **bump the migration range in `README.md`** (`001–NNN`) — CI's "README in sync with migrations and schema" check fails otherwise. Guard ALTERs for idempotency with an `INFORMATION_SCHEMA` check inside a stored procedure (see migration 371/374).
2. **Validation schema** in `src/middleware/schemas/` + model `fillable` — both must list every field the frontend will send.
3. **Route** with `requirePermission`. If a task is scheduled, **register its name as a `case` in `taskRunner.js`** — seeded tasks with no case never run, silently.
4. **OpenAPI**: the spec is **hand-written** in `src/utils/openapi.js`. Add the path entry, then `pnpm run openapi`. ⚠️ The spec-drift check only compares the generator to the committed JSON — **it does not know your route exists**, so a forgotten spec entry passes CI while the endpoint stays undocumented and untyped for the frontend.
5. **Frontend**: `pnpm run gen:api` then build the page; wire route in `App.tsx` + nav in `Layout.tsx` (an unrouted page is dead code); add i18n keys to **all three** locales (`en`, `es`, `pt-BR` — see `docs/language-guideline.md`).
6. **Tests**: backend jest (mock the **backend's** real response shape, never the frontend's expected shape — that masks contract drift), frontend vitest.

## Gotchas that have caused real bugs

- **Column names are the API contract.** `SELECT *` responses are unaliased DB columns. If a frontend interface guesses a different field name, it renders `undefined`/`—`/`NaN` with no error. This was the #1 historical bug class. Check the migration, not your intuition.
- **Request-shape drift is silent.** `validate()` ignores undeclared fields and `fillable` drops them — a misnamed form field or mismatched enum is lost or 422s with no client warning. This was bug class #2.
- **The frontend does not gate UI by permission.** There is no `usePermissions` hook; buttons render for everyone and the backend 403s. Expect visible-but-forbidden actions for restricted roles; don't add gating ad hoc without a plan.
- **`req.orgId`**, not `req.organizationId` (a past typo made every tax-report export return zero rows).
- Route order matters: literal paths (`/stats`, `/assignable-users`) must be declared **before** `/:id`.
- Some services are **honest stubs**: §18 script execution, §20 integration test/sync, FTTH live device I/O, non-MikroTik router drivers, parts of the payment gateway. Check whether the UI presents a stub as working before assuming a flow is real — a stub whose UI fakes success is a bug, not a feature.
- MySQL booleans round-trip as `0/1` — `validate()` coerces; don't "fix" that.
- ESLint `no-useless-escape` fires on `\-` in regex character classes (see agent-memory note).
- E2E (`e2e/`, Playwright) and `test:db` need Docker; plain `pnpm test` does not.

## Deploy

- `docker-compose.yml` (dev) / `docker-compose.prod.yml` (prod: MySQL, Redis, app, Nginx) / `docker-compose.test.yml` (integration DB) / `docker-compose.e2e.yml` / `docker-compose.host-nginx.yml`
- One-command production install: `install.sh` (clones to `/opt/fireisp`, TLS via Let's Encrypt)
- `k8s/` + `charts/` for Kubernetes/Helm; `docs/deployment.md`, `docs/backup-restore.md`
- FireRelay (remote NAS tunneling): `docs/firerelay.md`, `pnpm run firerelay:agent`
