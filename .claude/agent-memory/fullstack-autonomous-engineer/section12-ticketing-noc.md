---
name: section12-ticketing-noc
description: Section 12 Ticketing & NOC — migrations 297-299 complete; 7 tables, 14 perms, 3 route files; next migration: 300
metadata:
  type: project
---

## Status: Complete — migrations 297–299, commit 6ca6e92

**Why:** §12 adds NOC dashboard, work orders, technician GPS tracking, and ticket extensions (time logs, relations, AI triage, merge).

**How to apply:** All §12 routes are live in the worktree. Next section starts at migration 300.

## Tables added (7)

- `ticket_time_logs` — per-ticket time tracking (user_id FK, minutes INT, work_date DATE)
- `ticket_relations` — typed ticket relationships (duplicate/related/blocks/blocked_by; UNIQUE pair+type)
- `ticket_ai_triage` — AI triage results per ticket (UNIQUE on ticket_id)
- `work_orders` — field work orders with org scope, GPS coords, soft-delete
- `work_order_materials` — material usage per work order (CASCADE on work_order_id)
- `technician_gps_breadcrumbs` — append-only GPS log (NO FKs, composite index user_id+recorded_at DESC)
- `tickets.source` — column added via stored-procedure guard (ENUM manual/alert/portal/ai_escalated)

## Permissions added (14)

In `noc` module: `noc.view`, `work_orders.*` (5), `work_order_materials.*` (3), `technician_tracking.*` (2)
In `tickets` module: `ticket_relations.*` (2), `ticket_time_logs.*` (2)

## Route files added/modified

- `src/routes/nocDashboard.js` — GET /noc/health, /alarms, /outages, /ticket-queue, /events, /sla-compliance
- `src/routes/workOrders.js` — full CRUD + restore + materials sub-resource
- `src/routes/technicianTracking.js` — POST /breadcrumb, GET /positions, POST /route-optimize, GET /:userId/history
- `src/routes/tickets.js` — extended: GET /stats, POST /from-alert, /:id/relations, /:id/time-logs, /:id/ai-triage, /:id/ai-summary, /:id/merge

## Schema gotchas discovered during implementation

- `outages` table has NO `organization_id` column — must join via `sites.organization_id` to scope by org
- `ticket_sla_events` uses `is_breached TINYINT` (not `breached_at`) — SLA compliance query uses `is_breached = 0`
- `alert_events` has `metric` (not `message`) and `resolved_at` (not `active` flag)
- `eqeqeq` ESLint rule fires on `== null` checks — use explicit `=== null || === undefined` pattern

## Counts

- Tables: 249 total (was 242)
- Migrations: 001–299
- Endpoints: 346 (was 316)
- OpenAPI paths: 624
