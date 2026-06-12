---
name: section15-reporting-analytics
description: §15 Reporting & Analytics — migrations 308-313 complete; 5 tables, 11 perms, 712 total endpoints, 5 route files, 2 frontend pages; next migration: 314
metadata:
  type: project
---

## Status: COMPLETE (branch 15-of-isp-platform-feature.md)

**Why:** Implements all 30 §15 checkboxes (financial, operational, network, compliance, report engine).

**How to apply:** Next section starts at migration 314. Table count is 265, 712 endpoints, migrations 001-313.

## Post-run fix (orchestrator sweep — half-workflow, 5th occurrence)

The first run seeded 11 permissions but `reports.generate` and `reports.manage_definitions` were consumed by NO route, and `report_definitions` (created in 308, FK'd by scheduled_reports/generated_reports) was never read or written — dead schema, because scheduled reports dispatch by the `report_def_name` STRING and ignore `report_def_id`. Fixed in commit af2bad7:
- `POST /reports/generate` + `POST /scheduled-reports/:id/run` (both `reports.generate`) — on-demand generation via a shared `scheduledReportService.runOnDemand()` helper.
- `src/routes/reportDefinitions.js` — CRUD; list/get use `reports.view`, create/update/delete use `reports.manage_definitions`.
- Migration 313 seeds 34 built-in report_definitions rows (one per slug `generateReportData()` dispatches on), org NULL / is_system=1, idempotent WHERE-NOT-EXISTS.
RULE (reinforced): every seeded permission must be consumed by a route AND every created table must be read/written by code — sweep BOTH before declaring a section done.

## Database

- Migration 308: `report_definitions`, `scheduled_reports`, `generated_reports`
- Migration 309: `dashboard_widgets` (widget_type ENUM 8 values, per-user grid)
- Migration 310: `custom_reports` (query_type sql/visual, SELECT-only enforcement)
- Migration 311: 11 permissions seeded (reports.view/generate/schedule/export/manage_definitions, dashboard_widgets.view/manage, custom_reports.view/create/execute/manage)
- Migration 312: `generate_scheduled_reports` task (task_type=other, cron hourly) — taskRunner case + dispatch test added same commit
- Migration 313: seeds 34 built-in `report_definitions` rows (orchestrator fix — see above)
- Rollbacks in database/rollbacks/; schema.sql = 265 tables total

## Backend

- `src/services/reportService.js`: 34 functions total (4 original + 30 new)
  - All new functions use `db.queryReplica()` for SELECTs
  - `capacityForecast()`: linear regression implemented in JS (no external lib)
  - `snmpPollSuccess()`: joins through devices table since snmp_metrics has no org_id FK
- `src/services/scheduledReportService.js`: CSV/XLSX (exceljs)/PDF (pdfkit) formatting + email delivery
- `src/routes/reports.js`: 30 report endpoints + generic `/:report/export` (placed LAST to avoid shadowing named routes) + `POST /reports/generate` (orchestrator fix)
- `src/routes/reportDefinitions.js`: report_definitions registry CRUD (orchestrator fix)
- `src/routes/scheduledReports.js`: CRUD with soft-delete
- `src/routes/dashboardWidgets.js`: CRUD + PUT /batch — IMPORTANT: /batch route must come BEFORE /:id (express router order)
- `src/routes/customReports.js`: CRUD + POST /:id/execute with SELECT validation, LIMIT 1000 enforcement, 30s timeout
- `src/services/taskRunner.js`: `generate_scheduled_reports` case added
- exceljs installed: `pnpm add exceljs -w` (added to root package.json + lockfile)

## Permissions

11 permissions — role matrix:
- admin: all 11
- billing: 8 (no custom_reports.execute/manage)
- technician: reports.view + dashboard_widgets.view
- support: same as technician
- readonly: reports.view + dashboard_widgets.view + custom_reports.view

## Frontend

- `frontend/src/pages/Reports.tsx`: 5 new tabs (network, compliance, scheduled, custom, widgets)
  - Tab type includes: 'network' | 'compliance' | 'scheduled' | 'custom' | 'widgets'
  - Tab bar refactored into `ReportsTabBar` component using `useTranslation`
- `frontend/src/pages/AnalyticsDashboard.tsx`: new page at `/analytics-dashboard`, CSS grid widget layout
- `frontend/src/App.tsx`: AnalyticsDashboard route wired adjacent to reports route
- i18n: 37 new keys in en/es/pt-BR (reports.* + analyticsDashboard.* + nav.analyticsDashboard)

## Tests

- `tests/section15.test.js`: 30 integration tests (all 4 new route files)
- `tests/reportService.test.js`: expanded with 15 new unit tests for §15 functions
- `tests/taskRunner.test.js`: generate_scheduled_reports dispatch test added
- `frontend/src/pages/__tests__/AnalyticsDashboard.test.tsx`: 5 Vitest tests

## Key bugs fixed during implementation

1. `dashboardWidgets.js`: PUT `/batch` route must come BEFORE `/:id` — Express catches `/batch` as `:id` param otherwise. Fixed by reordering.
2. `reportService.test.js` needed exact return shape matching (cashFlowReport returns `{ rows }` not `{ inflows, outflows }`; taxSummary needs 2 parallel mocks; dataRetentionCompliance queries 4 tables in Promise.all).
3. data-retention-compliance route test needed isolated per-test mock setup (global beforeEach conflicted with sequential queryReplica calls).

## Pattern notes

- Reports.tsx uses `apiFetch<T>` helper (not typed openapi-fetch client) for new tabs
- AnalyticsDashboard.test.tsx uses `vi.stubGlobal('fetch', mockFetch)` since page uses raw fetch
- JSON locales must not have trailing commas after the last key/object at any level
