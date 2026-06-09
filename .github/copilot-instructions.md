# Repository Custom Instructions

## Reasoning & Effort
- Always use "High" reasoning effort for architectural changes.
- Before suggesting code, perform a reasoning step to check for breaking changes in the RADIUS or Docker configurations.

## Project Context
- This is a Ubuntu-based ISP management software.
- Hardware stack includes MikroTik (Queue Trees, CoA), Ruijie, and Ubiquiti.
- Database is MySQL/MariaDB for Traccar and billing.

## Definition of Done (Mandatory)
- Every checklist item is only considered done after required tests pass for all impacted layers: database, backend, frontend, and e2e (when flow-impacting).
- Do not mark tasks complete based on code changes alone.
- If a test cannot run, explicitly document why, what was run instead, and the remaining risk.

## Required Impact Check Before Coding
- Classify change impact as one or more of: database, backend API/business logic, frontend UI/state, e2e user flow, infra/config.
- Select and run tests from the matrix below based on impact.
- Include a short pre-change risk check for RADIUS and Docker-related regressions whenever touched.

## Mandatory Test Matrix
- Database changes (schema, migrations, SQL, seed, data access):
	- Run: `pnpm migrate:smoke-test`
	- Run: `pnpm test:db`
	- If migration-related behavior changed, also run: `pnpm test`

- Backend changes (routes, controllers, services, middleware, auth, billing logic, integrations):
	- Run: `pnpm test`
	- Run focused tests for touched modules when available, then full suite for final verification.

- Frontend changes (pages, components, hooks, i18n, API client usage):
	- Run: `pnpm --filter fireisp-frontend lint`
	- Run: `pnpm --filter fireisp-frontend test`
	- For release-critical UI/API changes, also run: `pnpm --filter fireisp-frontend build`
	- CRITICAL: Never bypass the build check. Copilot must verify that all static pages, navigation menus, and GUI components compile successfully without TypeScript or linter errors.
  - If any UI component or button breaks the build, Copilot must fix the type/import mismatches entirely before pushing code.

- End-to-end flow changes (signup, client lifecycle, contract, invoice, payment, suspension/reactivation, portal critical paths):
	- Run: `pnpm --filter fireisp-e2e test`
	- If e2e environment is unavailable, record blocker and list exact unverified flows.

## Evidence and Reporting Rules
- For each completed checklist item, report:
	- What changed
	- Which test commands were run
	- Pass/fail result per command
	- Known gaps or blockers
- Never claim "complete" without test evidence.

## Documentation Update Rule (Mandatory)
- Update `README.md` when a change affects any of the following:
	- setup or run steps
	- test commands or quality gates
	- environment variables or required services
	- API behavior expected by integrators/operators
- In the completion summary, explicitly state whether `README.md` was updated and why.

## Change Safety Rules (Essential)
- For database migrations:
	- Ensure forward migration and rollback path are both valid.
	- Avoid destructive data operations unless explicitly requested.
- For backend API changes:
	- Preserve existing contracts unless a versioned change is intended.
	- Update OpenAPI/docs when behavior or payload changes.
- For frontend API usage:
	- Prefer typed client patterns already used in the repo.
	- Avoid introducing untyped ad-hoc request paths when typed paths exist.
- For security-sensitive areas:
	- Re-check auth, RBAC, tenant isolation, and audit logging impact.
- For infra touches:
	- Validate Docker and service config compatibility assumptions before finalizing.
