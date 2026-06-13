# FireISP 5.0 — APIs & Integrations (§20)

## 20.1 Core REST API

All capabilities below were already built across Sections 1–19. This section
confirms they exist; gaps are noted as deferred.

| Capability | Status | Notes |
|---|---|---|
| Full CRUD — customers | EXISTS | `GET/POST/PUT/DELETE /api/v1/clients` (+ contacts, MX profile, DnD) |
| Full CRUD — plans | EXISTS | `GET/POST/PUT/DELETE /api/v1/plans` |
| Full CRUD — invoices | EXISTS | `GET/POST/PUT/DELETE /api/v1/invoices` |
| Full CRUD — tickets | EXISTS | `GET/POST/PUT/DELETE /api/v1/tickets` |
| Full CRUD — devices | EXISTS | `GET/POST/PUT/DELETE /api/v1/devices` |
| Full CRUD — OLTs | EXISTS | `/api/v1/olt-management` (§7) |
| Full CRUD — ONUs | EXISTS | `/api/v1/onu-management` (§7) |
| Full CRUD — RADIUS sessions | EXISTS | `/api/v1/radius` (§5, connection logs) |
| Pagination / filtering / sorting | EXISTS | All list endpoints accept `?limit=&offset=&search=` |
| Webhook event dispatch | EXISTS | `webhookService.js` dispatches: `payment.received`, `outage.reported`, `outage.resolved`, `ticket.created`, `device.offline`, `device.online`, `invoice.created`, `contract.suspended`, `contract.restored`, `service_order.activated`, `refund.processed`, `pppoe.auth_failures`, `maintenance.scheduled`, and more |
| OpenAPI / Swagger docs | EXISTS | `docs/openapi.json` (regenerated via `pnpm openapi`); Swagger UI at `/api/docs` |
| Rate limiting / throttling | EXISTS | `apiLimiter`, `authLimiter`, `exportLimiter`, `sseLimiter`, `webhookLimiter` in `src/middleware/rateLimit.js`; per-API-key rate limits via `api_key_rate_limits` table (§17) |

### Webhook Events (from notificationHooks.js)

The following event types are dispatched to registered webhooks:

| Event | Trigger |
|---|---|
| `payment.received` | Invoice paid |
| `outage.reported` | Outage created |
| `outage.resolved` | Outage marked resolved |
| `service_order.activated` | Service order activated |
| `invoice.created` | Invoice generated |
| `contract.suspended` | Contract suspended |
| `contract.restored` | Contract reactivated |
| `ticket.created` | Support ticket opened |
| `device.offline` | Device SNMP offline |
| `device.online` | Device SNMP back online |
| `device.trap` | SNMP trap received |
| `followup.due` | Follow-up reminder due |
| `survey.requested` | Satisfaction survey triggered |
| `ticket.escalated` | Ticket escalation |
| `maintenance.scheduled` | Maintenance window created |
| `refund.requested` | Refund request opened |
| `refund.processed` | Refund completed |
| `pppoe.auth_failures` | PPPoE auth failure threshold |
| `ip_pool.threshold` | IP pool utilization threshold |

### 20.1 Deferred / Gap Notes

- **new subscriber** webhook event: `service_order.activated` is the closest existing event and covers new subscriber activation. A dedicated `client.created` webhook event does not exist — noted as a minor gap; not added in this section to avoid unscoped changes to notificationHooks.js.
- **Sorting on list endpoints**: The existing pattern is `?search=` + `?limit=`/`?offset=`; explicit `?sort_by=`/`?sort_dir=` parameters are not universally implemented across all routes. Assessed as a mass-refactor deferred item.

---

## 20.2 Third-Party Integration Framework

### Architecture

Three new tables (migrations 348–349):

| Table | Purpose |
|---|---|
| `integration_providers` | Read-only catalog of 27 supported providers (seeded in migration 348) |
| `integration_connections` | Per-org configured connection instances; `credentials_enc` column uses AES-256-GCM (same `encrypt()`/`decrypt()` util as §6 alert channels and §17) |
| `integration_sync_logs` | Execution records per connection (direction, status, counts, error) |

### API Endpoints

Base path: `/api/v1/integrations` — all require JWT auth + `X-Org-Id`.

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/integrations/providers` | `integration_providers.view` | List provider catalog (filterable by `?category=`) |
| GET | `/integrations/providers/:id` | `integration_providers.view` | Get single provider |
| GET | `/integrations/connections` | `integration_connections.view` | List org connections (no credentials returned) |
| POST | `/integrations/connections` | `integration_connections.create` | Create connection (credentials encrypted) |
| GET | `/integrations/connections/:id` | `integration_connections.view` | Get connection (no credentials) |
| PUT | `/integrations/connections/:id` | `integration_connections.update` | Update connection; re-encrypts credentials if provided |
| DELETE | `/integrations/connections/:id` | `integration_connections.delete` | Hard delete (destroys credentials) |
| POST | `/integrations/connections/:id/test` | `integration_connections.test` | Test connection |
| POST | `/integrations/connections/:id/sync` | `integration_connections.sync` | Trigger sync |
| GET | `/integrations/connections/:id/logs` | `integration_sync_logs.view` | List sync logs |

### Provider Catalog

27 providers seeded across 8 categories:

| Category | Providers | Status |
|---|---|---|
| `accounting` | QuickBooks, ContPAQi, SAP, ERPNext | STUBBED |
| `payment_gateway` | Stripe, PayPal, Conekta, Openpay, MercadoPago, OXXO Pay | Stripe + Conekta DELEGATE to `paymentGatewayService.js`; PayPal, Openpay, MercadoPago, OXXO Pay STUBBED |
| `communication` | Twilio, Vonage, WhatsApp Business, SendGrid | Twilio + Vonage DELEGATE to `smsTransport.js`; SendGrid DELEGATES to `emailTransport.js`; WhatsApp Business STUBBED |
| `maps` | Google Maps, OpenStreetMap, MapBox | STUBBED |
| `monitoring` | Zabbix, Prometheus, Grafana, PRTG | STUBBED |
| `helpdesk` | Zendesk, Freshdesk, osTicket | STUBBED |
| `tax_sat` | CFDI 4.0 PAC | DELEGATES to `cfdiService.js` |
| `lorawan` | ChirpStack | STUBBED |

### Credential Security

- Credentials are encrypted using `encrypt()` from `src/utils/encryption.js` (AES-256-GCM, 12-byte IV, 16-byte auth tag, `iv:authTag:ciphertext` hex format) before storage in `credentials_enc`.
- Credentials are **never returned** in any API response — the `credentials_enc` column is excluded from all SELECT queries in `integrationService.js`.
- Credentials are **never logged** — the service explicitly avoids logging the credentials object.
- On DELETE, the row (including `credentials_enc`) is hard-deleted.

### Stub Notice

`testConnection()` and `sync()` are **fully stubbed** for all providers. They:
1. Verify the connection exists and is enabled.
2. Insert a `integration_sync_logs` row with `status = 'stubbed'`.
3. Update `integration_connections.status` to `'active'` and `last_synced_at`.
4. Return the log entry.

No live HTTP calls are made. Connectors for providers that have existing FireISP services (Stripe/Conekta, Twilio/Vonage, SendGrid, CFDI PAC) note the delegation path in code comments but do not call those services from `testConnection`/`sync` — the existing services have their own connectivity mechanisms (circuit breakers, PAC health checks).

### Frontend

`/integrations` route — `IntegrationsPage.tsx` — 3-tab UI:

1. **Providers** — filterable catalog table
2. **Connections** — CRUD form + test/sync/delete actions; note on credential encryption shown to user
3. **Sync Logs** — per-connection log history (viewed by clicking "Logs" on a connection)

Navigation: Admin section → "Integrations" (`nav.integrations` i18n key, en/es/pt-BR).
