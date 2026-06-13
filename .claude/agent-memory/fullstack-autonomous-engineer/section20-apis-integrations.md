---
name: section20-apis-integrations
description: Section 20 APIs & Integrations — migrations 348-350, 3 new tables (313 total), 8 perms, 10 endpoints, 3-tab frontend page, docs/api-and-integrations.md
metadata:
  type: project
---

Section 20 (APIs & Integrations) complete. Migrations 348-350. Next migration: 351.

## 20.1 Core REST API — VERIFIED EXISTING (no new tables)
All listed capabilities existed across prior sections:
- Full CRUD: clients, plans, invoices, tickets, devices, olt-management, onu-management, radius
- Pagination: ?limit=&offset=&search= pattern on all list endpoints
- Webhooks: webhookService.js with 19 event types (payment.received, outage.reported, outage.resolved, service_order.activated, invoice.created, contract.suspended, device.offline, ticket.created, etc.)
- OpenAPI: docs/openapi.json + Swagger UI at /api/docs (838 paths after §20)
- Rate limiting: apiLimiter, authLimiter, exportLimiter + api_key_rate_limits table (§17)
- Gap noted: "new subscriber" webhook = service_order.activated; no dedicated client.created event
- Gap noted: sort_by/sort_dir not universally implemented (deferred)

## 20.2 Integration Framework

### New Tables
- `integration_providers` (migration 348) — read-only catalog of 27 providers; seeded idempotently via UNIQUE key on provider_key; category ENUM
- `integration_connections` (migration 349) — per-org instances; credentials_enc (AES-256-GCM); config_json
- `integration_sync_logs` (migration 349) — direction/status/records_in/out/error

### Providers Seeded (27 total)
| Category | Providers |
|---|---|
| accounting | quickbooks, contpaqi, sap, erpnext |
| payment_gateway | stripe, paypal, conekta, openpay, mercadopago, oxxo_pay |
| communication | twilio, vonage, whatsapp_biz, sendgrid |
| maps | google_maps, openstreetmap, mapbox |
| monitoring | zabbix, prometheus, grafana, prtg |
| helpdesk | zendesk, freshdesk, osticket |
| tax_sat | cfdi_pac |
| lorawan | chirpstack |

### Service: integrationService.js
- NEVER exports getDecryptedCredentials (internal only, prefixed _)
- testConnection() and sync() are FULLY STUBBED — return status='stubbed', insert sync log, no live HTTP
- Credentials encrypted via encrypt() from src/utils/encryption.js; never returned in API responses
- Providers that DELEGATE to existing services (noted in comments but NOT called from test/sync):
  - stripe, conekta → paymentGatewayService.js
  - twilio, vonage → smsTransport.js
  - sendgrid → emailTransport.js
  - cfdi_pac → cfdiService.js

### Permissions (8 total, migration 350)
integration_providers.view, integration_connections.view/create/update/delete/test/sync, integration_sync_logs.view
Granted to: admin, super_admin

### Routes: src/routes/integrations.js
10 endpoints at /api/v1/integrations:
- GET/GET-by-id /providers
- GET/POST /connections; GET/PUT/DELETE /connections/:id
- POST /connections/:id/test; POST /connections/:id/sync; GET /connections/:id/logs

### Frontend: IntegrationsPage.tsx
3-tab UI (Providers, Connections, Sync Logs). Wired into App.tsx at /integrations (admin route), Layout.tsx admin nav (nav.integrations key).
i18n namespace: `integration.*` with `categoryNames` (nested object) and `category` (string header) — both are distinct keys (duplicate key fixed).

### i18n Key Fix
IMPORTANT: en.json had duplicate `"category"` key — once as nested object (category names), once as string "Category" for column header. Fixed by renaming nested object to `"categoryNames"` and adding `"categoryLabel"` for the filter label. The column header remains `"category": "Category"`.

### Docs
docs/api-and-integrations.md — full capability inventory, provider table, stub notice

## Counts
- 313 total tables in schema.sql
- 350 migration files (001-350)
- README updated with table rows 311-313 and migration note 348-350
- 39 Jest tests in tests/section20.test.js
- Coverage: 72.45% (was 72.31%)
- OpenAPI: 838 paths total

**Why:** `jest.resetAllMocks()` in beforeEach is needed (not just clearAllMocks) when tests use both mockImplementation AND mockResolvedValueOnce to avoid mock queue pollution between tests.
