# FireISP 5.0

Open source ISP management software for customer operations, billing, network management, compliance, and modern self-service/admin workflows.

## Quick Install

Deploy FireISP 5.0 on any Linux server with Docker in a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/vothalvino/fireisp5.0/main/install.sh | bash
```

The installer will prompt for your domain name and email, then automatically:

- Clone the repository to `/opt/fireisp`
- Generate strong random passwords and secrets
- Obtain a free TLS certificate via Let's Encrypt
- Build and start all containers (MySQL, Redis, app, Nginx)
- Run database migrations and seed default data

**Prerequisites:** Docker 24+, Docker Compose v2, Git, OpenSSL — all on a server where the domain already resolves.

### Options

Pass variables before the pipe to skip interactive prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/vothalvino/fireisp5.0/main/install.sh \
  | DOMAIN=isp.example.com EMAIL=admin@example.com bash
```

| Variable | Default | Description |
|---|---|---|
| `DOMAIN` | *(prompted)* | Public domain name pointing to this server |
| `EMAIL` | *(prompted)* | Admin email — used for Let's Encrypt and first login |
| `INSTALL_DIR` | `/opt/fireisp` | Installation directory |
| `SKIP_TLS` | `0` | Set to `1` to use a self-signed certificate (dev/testing) |
| `CF_API_TOKEN` | — | Cloudflare API token — enables DNS-01 wildcard certificates |
| `DB_PASSWORD` | *(auto-generated)* | MySQL application user password |
| `DB_ROOT_PASSWORD` | *(auto-generated)* | MySQL root password |
| `MYSQL_REPL_PASSWORD` | *(auto-generated)* | MySQL replication password |
| `REDIS_PASSWORD` | *(auto-generated)* | Redis password |
| `JWT_SECRET` | *(auto-generated)* | JWT signing secret (64 chars) |
| `ENCRYPTION_KEY` | *(auto-generated)* | AES-256 key for secrets stored at rest |
| `GOOGLE_MAPS_API_KEY` | — | Google Maps Geocoding API key — enables resolving a client service address to GPS coordinates (`POST /clients/:id/geocode`). When unset, geocoding returns `503` and coordinates can still be entered manually. |

All generated credentials are saved to `/opt/fireisp/.env.prod` (mode `600`).

> **Full deployment guide:** [`docs/deployment.md`](docs/deployment.md) covers bare-metal, Docker Compose, Kubernetes, TLS setup, MySQL tuning, and a production checklist.
> **FreeRADIUS integration:** [`docs/freeradius/README.md`](docs/freeradius/README.md) covers installing FreeRADIUS 3.x, pointing `rlm_sql` at the FireISP MySQL database, enabling PPPoE/MAB/802.1X/EAP-TLS, and generating `clients.conf` from the `nas` table.

## Features

- Customer management
- Service plan management
- Billing, invoicing, and credit notes with multi-currency support (ISO 4217)
- SAT CFDI 4.0 Mexican e-invoicing — PAC stamping (Finkok, SW Sapien, FacturAPI, etc.), CSD certificate management with expiry monitoring, Complemento de Pago 2.0, cancellation workflow, factura pública aggregation (venta al público en general)
- Payment gateway integrations (Stripe, Conekta, OpenPay, MercadoPago, PayPal) with recurring autopay profiles and stored card tokens
- Network device monitoring with SNMP metrics collection
- Connection logging for regulatory compliance and per-contract data usage (RADIUS accounting)
- Inventory and warehouse management — track spare equipment across multiple storage locations
- User and role management with RBAC (roles, permissions, role_permissions) — default roles and permissions seeded on install
- IP address management (IPAM) with IPv4, IPv6, and dual-stack support
- Audit logging and notifications
- Email / SMS / WhatsApp send log for auditing and billing disputes
- Service outage tracking with SLA reporting hooks
- Scheduled task observability and active session management — fifteen core automation tasks seeded on install (`auto_generate_invoices`, `auto_suspend_overdue`, `radius_sync`, `populate_revenue_summary`, `populate_network_health_snapshots`, `csd_expiry_monitor`, `alert_evaluation`, `process_recurring_charges`, `data_retention`, `payment_retry`, `billing_cycle`, `database_backup`, `config_backup`, `webhook_retry`, `quarterly_dr_drill`)
- Monitoring alert rules with configurable thresholds, severity levels, and multi-channel notifications (email, SMS, SSE, webhook)
- Two-factor authentication (TOTP) with backup codes and brute-force account lockout
- Single sign-on (SSO) — per-organization SAML 2.0 and OIDC IdP configuration, automatic user provisioning on first login, and IdP group-to-FireISP role mappings
- Per-tenant resource quotas — configurable upper bounds per organization for clients, devices, storage, and scheduled tasks (NULL = unlimited; absence of a quota row = unlimited)
- Per-tenant database isolation — opt-in physically isolated MySQL/MariaDB database per organization; tenant-aware pool routing via `AsyncLocalStorage` context in `orgScope`; admin API to configure, verify (`POST /test`), and switch between shared and isolated modes; `MIGRATE_ISOLATED_TENANTS=true npm run migrate` applies the same migration set to every enabled isolated tenant database
- Background job platform (BullMQ) — optional Redis-backed distributed job queues for webhook delivery, SMS dispatch, CFDI stamping retries, config-backup pulls, and scheduled-task execution; inline fallback when `REDIS_URL` is not configured; per-queue stats surfaced at `/api/v1/queue-stats`
- FireRelay cluster mode for multi-node deployments with client routing
- Outbound webhooks with HMAC signing, configurable retries, and dead-letter queue for failed deliveries
- Inbound webhook event deduplication and idempotent payment processing
- Configurable suspension rules — auto-suspend, auto-disconnect, and notify-only actions with grace periods and plan-scoping
- Data retention policies with configurable TTL purge (audit logs, alert events, webhook deliveries, email/SMS logs, idempotency keys)
- Circuit breaker pattern for external service resilience (RADIUS, payment gateways, PAC stamping)
- Geographic service areas and coverage zones with WGS 84 boundary polygons
- Speed test recording from client portal, technician tools, automated probes, and external services
- IFT/CRT regulatory compliance — concession titles, periodic filings, statistical reports, and registered contract templates (Carta de Adhesión)
- Customer lifecycle management — lead capture and prospect pipeline, service order workflow (request → approval → provisioning → activation) with onboarding checklists, automated welcome email/SMS on activation, win-back campaigns for cancelled customers, and churn analytics with predictive at-risk alerts
- Customer interaction tracking — unified per-client activity timeline (calls, emails, tickets, payments, visits), manual interaction logging, follow-up reminders with automated due notifications, NPS/CSAT satisfaction surveys (auto-dispatched on ticket resolution) with aggregate metrics, and ticket escalation management with auto-escalation of stale unresolved tickets
- Internationalization (i18n) — English, Spanish, and Brazilian Portuguese locale support
- Customer self-service portal (§11) — dashboard with plan overview, live session status, daily usage graph; invoice PDF/CFDI download; online payment (card/OXXO/SPEI/PayPal via checkout session); payment history; self-service requests (plan upgrade with proration, Wi-Fi/PPPoE password change, static IP, cancellation, visit schedule) with admin approval workflow; knowledge-base / FAQ with rating; embedded speed test (queues `subscriber_speed_test_jobs`, results view); AI-powered chatbot with automatic ticket-creation fallback; callback request; Web Push notification subscriptions (outage/billing/ticket events); PWA with offline service worker and web app manifest
- RESTful API with 763 REST API endpoints, interactive Swagger UI documentation (`/api/docs`), and static OpenAPI spec (`docs/openapi.json`)
- GraphQL gateway (`/api/v1/graphql`) powered by graphql-yoga v5 — single-request multi-entity fetches, real-time subscriptions via SSE (PubSub), and a live ClientDetail query replacing multiple REST round-trips
- Real-time event hub (WebSocket + SSE dual-broadcast) — live Dashboard device-status indicator, live TicketDetail comment stream, and a useWebSocket React hook for all frontend consumers
- httpOnly SameSite=Strict cookie authentication — access token in memory, refresh token in httpOnly cookie, Origin-based CSRF guard; eliminates localStorage token exposure
- Dark mode — CSS custom-property token system, per-user preference persisted in localStorage, toggle in Layout and PortalLayout
- PROFECO complaint management — complaint register for ISPs subject to CONCILIANET obligations: intake, lifecycle tracking, staff attribution, quarterly export for regulatory filing
- Spec-driven development — `spec:check` drift scanner detects route/schema gaps against the OpenAPI spec in CI; `spec:gen` scaffolds new route stubs from the spec
- Schema-truth enforcement — `sql:check` statically verifies that every `INSERT`/`UPDATE` in the backend names columns that actually exist on that table in `database/schema.sql`, and that every literal written to an `ENUM` column is one of its values. The Jest suite mocks the database, so this is the only gate that catches a mistyped column before it becomes a permanent 500 in production
- OWASP ZAP DAST scan in CI — automated active scan against a live test instance on every push; ZAP HTML report uploaded as a workflow artifact
- WCAG 2.1 AA accessibility — jest-axe audit on all major pages; aria-label fixes across TicketList, UserList, and other interactive components
- AI Reply Assistant — topology-aware LLM chatbot that drafts (and optionally auto-sends) professional answers to inbound support tickets; pluggable provider registry (OpenAI, Azure OpenAI, Anthropic, Google Gemini, Ollama, custom); phrase library with forbidden-term guard; PII redaction before prompt dispatch; per-org master on/off switch and per-channel toggles; optional RAG via ChromaDB; full audit log. **Emergency kill switch:** `PUT /api/v1/ai/policy` `{"enabled":false}` or untick the master switch in Settings → AI Assistant → General.
- In-app changelog panel — paginated, filterable release history surfaced in the admin sidebar for operators who need to track what changed without leaving the UI
- Kubernetes-ready health probes — `/health/live` (liveness), `/health/ready` (readiness with DB + Redis checks), `/health?detail=true` (detailed)
- CSP nonce-based inline style protection (per-request nonce replaces `unsafe-inline`)
- API versioning with deprecation headers (`Deprecation`, `Sunset`, `Link`) on unversioned `/api/` routes
- IETF draft-7 `RateLimit-*` response headers for API consumers
- Optimistic concurrency control on critical financial records (invoices, contracts, payments, clients)
- Default application settings seeded on install (currency, SMTP, SNMP, security, automation flags)
- Default tax rates seeded on install (Tax Exempt, Standard 8%, IVA 16% MX, GST 5% CA)
- Payment allocation, inventory stock, PPPoE RADIUS consistency, credit note over-credit cap, audit log immutability, CFDI document immutability, contract status FSM, and outage temporal logic enforced at the database level via guard triggers

## Project Structure

```
fireisp5.0/
├── database/                # Database schema and migrations
│   ├── schema.sql           # Combined schema (all 326 tables + column additions)
│   └── migrations/          # Individual numbered migration files (001–385)
├── src/                     # Express API, services, middleware, scripts, and workers
│   ├── app.js               # Express app setup
│   ├── server.js            # HTTP server entry point
│   ├── config/              # App configuration and environment settings
│   ├── controllers/         # Request handlers / route controllers
│   ├── locales/             # i18n translation files (en.json, es.json, pt-BR.json)
│   ├── middleware/          # Authentication, logging, validation, and request middleware
│   │   └── schemas/         # Validation schemas per route
│   ├── models/              # Data models / ORM-style entities
│   ├── routes/              # Route definitions
│   ├── scripts/             # CLI scripts (migrate, seed, backup, admin, openapi, postman, spec)
│   ├── services/            # Business logic layer
│   ├── workers/             # Background worker entrypoints
│   ├── utils/               # Shared helpers
│   └── views/               # Email templates
├── storage/                 # User-uploaded and system-generated files
│   ├── devices/             # Per-device files (history, evidence)
│   ├── clients/             # Per-client files (documents, notification logs)
│   ├── tickets/             # Per-ticket files (chat history, attachments)
│   ├── organizations/       # Organization-level files (logos, maps, SAT docs)
│   └── backups/             # System database and config backups
├── docs/                    # Project documentation
├── frontend/                # React + TypeScript admin SPA (Vite)
├── e2e/                     # Playwright smoke tests
├── tests/                   # Backend/unit/integration test suites
├── LICENSE
└── README.md
```

## Database

FireISP 5.0 uses MySQL 8.0+ (or MariaDB 10.6+). The schema is located in the `database/` directory.

### Quick Start

Apply the full schema in one step:

```bash
mysql -u <user> -p <database_name> < database/schema.sql
```

Or apply each migration in order:

```bash
for f in database/migrations/*.sql; do mysql -u <user> -p <database_name> < "$f"; done
```

### Database Tables

| # | Table | Description |
|---|-------|-------------|
| 1 | `users` | System users and employees (admins, technicians, billing, support) |
| 2 | `clients` | ISP customer records |
| 3 | `contacts` | Contact persons associated with clients |
| 4 | `sites` | Transport network NMS locations (POPs, data centers, towers, aggregation nodes) |
| 5 | `plans` | Internet service packages |
| 6 | `contracts` | Service contracts linking clients to plans — includes per-contract `facturar` flag for MX invoicing (TRUE = individual CFDI, FALSE = factura pública) |
| 7 | `nas` | Network Access Servers for RADIUS authentication |
| 8 | `radius` | RADIUS subscriber authentication accounts |
| 9 | `devices` | Network equipment inventory — client CPE (outdoor/indoor) and POP infrastructure (PTP, PTMP, OLT, Router, Switch, ONU) |
| 10 | `tickets` | Customer support tickets |
| 11 | `invoices` | Billing records issued to clients |
| 12 | `payments` | Payment records received from clients |
| 13 | `quotes` | Service estimates and proposals |
| 14 | `expenses` | Operational expenses, optionally linked to a work order |
| 15 | `organizations` | ISP company / tenant configuration |
| 16 | `files` | File metadata for entity-scoped storage (devices, clients, tickets, organizations, backups) |
| 17 | `ip_pools` | IP address pools for subscriber assignment (IPAM) — supports both IPv4 and IPv6 pools |
| 18 | `ip_assignments` | Individual IP / prefix assignments to clients and devices (IPv4 single-address or IPv6 prefix delegation) |
| 19 | `audit_logs` | System-wide audit trail (who changed what and when) |
| 20 | `notifications` | User notifications and alerts (billing, network, tickets) |
| 21 | `invoice_items` | Individual line items that make up an invoice's subtotal |
| 22 | `quote_items` | Individual line items that make up a quote's subtotal |
| 23 | `ticket_comments` | Conversation tracking and internal notes on support tickets |
| 24 | `snmp_metrics` | Raw SNMP poll data (5-min intervals, 90-day retention) — wide table, one row per device/interface per poll, partitioned by month |
| 25 | `snmp_metrics_1hr` | Hourly SNMP metric aggregates (avg/min/max per metric column, 1-year retention) |
| 26 | `snmp_metrics_1day` | Daily SNMP metric aggregates (avg/min/max per metric column, 3+ year retention) |
| 27 | `snmp_metrics_1month` | Monthly SNMP metric aggregates (avg/min/max per metric column, 3-year retention via high-watermark rollup from snmp_metrics_1day) |
| 28 | `snmp_rollup_state` | High-watermark table tracking the last successfully rolled-up timestamp per tier |
| 29 | `snmp_profiles` | SNMP OID polling profiles — named templates that map device brands/models to their OIDs |
| 30 | `snmp_profile_oids` | Individual OID-to-column mappings belonging to an SNMP profile |
| 31 | `snmp_traps` | SNMP trap receiver log — stores unsolicited trap messages (coldStart, warmStart, linkDown, linkUp, authenticationFailure, egpNeighborLoss, enterpriseSpecific) from network devices |
| 32 | `dr_drill_logs` | Audit log for automated quarterly DR-drill runs — records backup verification, referential-integrity checks, financial-consistency queries, and pass/fail status |
| 33 | `connection_logs` | Subscriber session events (start/stop/interim-update) for regulatory compliance and per-contract data usage — partitioned by month, 2-year retention |
| 34 | `warehouses` | Physical storage locations for spare equipment and materials (multiple warehouses supported) |
| 35 | `inventory_items` | Catalog of spare equipment and materials (antennas, cables, routers, ONUs, etc.) |
| 36 | `inventory_stock` | Current stock levels per item per warehouse location (aisle / column / shelf) |
| 37 | `inventory_transactions` | Immutable log of every stock movement — receiving, job assignments, client sales, transfers, returns, and adjustments |
| 38 | `credit_notes` | Credit notes issued to clients — for returns, courtesy, service outages, billing errors, duplicate payments, downgrades, cancellations, etc. |
| 39 | `credit_note_items` | Individual line items that make up a credit note's subtotal |
| 40 | `payment_allocations` | Junction table for split payments — records what portion of a payment was applied to each invoice (supports one-payment-many-invoices) |
| 41 | `billing_periods` | Tracks each contract's billing windows — which periods have been invoiced, which are upcoming, and when the next invoice should be auto-generated |
| 42 | `network_links` | Device-to-device connections — fiber, wireless, copper, or virtual links with capacity and interface metadata |
| 43 | `settings` | App settings / key-value configuration store — system-wide settings such as default tax rate, currency, invoice prefix, SMTP config, and SNMP poll interval |
| 44 | `tax_rules` | Tax rules per region and service type — supports VAT, sales tax, GST, and other regional tax configurations for multi-country ISPs |
| 45 | `client_balance_ledger` | Running account balance per client (prepaid / postpaid tracking) — records every debit (invoice, usage deduction) and credit (payment, top-up, credit note, adjustment) with a running balance; supports prepaid (credit remaining) and postpaid (amount owed) billing models |
| 46 | `email_logs` | Email / SMS / WhatsApp send log — records every message sent to clients or internal users with delivery status (queued, sent, delivered, failed, bounced) |
| 47 | `scheduled_tasks` | App-level task queue — dispatches recurring and one-shot jobs (auto-suspend overdue clients, generate invoices, RADIUS sync, SNMP polls) with cron scheduling, distributed locking, retry logic, priority ordering, and JSON payloads |
| 48 | `user_sessions` | Active session tracking for security audit — stores hashed session tokens, IP address, user-agent, and expiry; enables "logout all devices" and suspicious-login detection |
| 49 | `portal_refresh_tokens` | Client self-service portal refresh tokens — stores SHA-256 hashed tokens for long-lived authentication with expiry and revocation tracking |
| 50 | `roles` | RBAC role definitions — named roles with optional system-role flag (system roles cannot be deleted) |
| 51 | `permissions` | RBAC permission definitions — granular permission slugs (e.g. `clients.view`, `invoices.create`) grouped by functional module |
| 52 | `role_permissions` | RBAC junction table — maps roles to their granted permissions (many-to-many) |
| 53 | `outages` | Planned and unplanned outage log — tracks network-wide events affecting many clients at once, per site and/or device with start/end times, severity, affected client count, root cause, and resolution status |
| 54 | `schema_migrations` | Migration state tracking — records which migration files have been applied so the deploy script can skip already-run files |
| 55 | `vlans` | VLAN registry linked to sites — tracks IEEE 802.1Q VLAN IDs per site for network segmentation, service isolation, and capacity planning |
| 56 | `tax_rates` | Named tax configurations (e.g. "IVA 16%", "Exempt", "GST 5%") — master table of reusable tax rates referenced by invoices, quotes, and credit notes |
| 57 | `message_templates` | Reusable message templates for email, SMS, and WhatsApp — stores subject, body, and placeholder variables for outbound communications (invoice reminders, welcome messages, outage alerts) |
| 58 | `api_tokens` | API keys for external integrations — hashed token secrets with optional scopes, expiry, revocation, and last-used tracking for third-party billing, monitoring tools, and custom integrations |
| 59 | `promotions` | Coupon codes, promotional pricing, and referral discounts — supports percentage and fixed-amount discounts with optional coupon codes, validity windows, per-client usage limits, and minimum order thresholds |
| 60 | `service_areas` | Geographic service areas (regions / markets) for sales territory assignment and network planning — named boundary polygons (WGS 84) linked to sites, with planned/active/retired status and map colour |
| 61 | `coverage_zones` | Coverage zones within a service area — finer-grained polygons describing network reach, access technology (fiber, fixed wireless, DSL, cable, satellite, LTE, 5G), maximum speeds, and build-out status |
| 62 | `sla_definitions` | SLA terms per plan — uptime guarantees (e.g. 99.95%), maximum response and resolution times, compensation rules for SLA breaches, measurement periods, and maintenance-window exclusions |
| 63 | `device_config_backups` | Versioned configuration snapshots per device — stores MikroTik exports, RouterOS backups, Cisco running-config, and similar captures with SHA-256 checksums for change detection, version tracking, and capture method (manual, scheduled, pre/post change) |
| 64 | `client_mx_profiles` | Mexico extension for clients (1:1) — required when `clients.locale = 'MX'` and at least one contract has `facturar = TRUE`; stores RFC, CURP, razon_social, regimen_fiscal, codigo_postal_fiscal, and Mexican address fields for CFDI 4.0 compliance |
| 65 | `organization_mx_profiles` | Mexico extension for organizations (1:1) — required when `organizations.locale = 'MX'`; stores RFC, razon_social, CSD digital-seal certificate, PAC stamping credentials, CFDI series/folio numbering, and Mexican address fields |
| 66 | `sat_regimen_fiscal` | SAT catalog c_RegimenFiscal — fiscal regime codes (601–626) used on CFDI 4.0 issuer and receptor nodes |
| 67 | `sat_uso_cfdi` | SAT catalog c_UsoCFDI — permitted use codes for the CFDI receptor (G01, G03, S01, CP01, etc.) |
| 68 | `sat_forma_pago` | SAT catalog c_FormaPago — payment instrument codes (01=cash, 03=SPEI, 28=debit card, 99=TBD, etc.) |
| 69 | `sat_metodo_pago` | SAT catalog c_MetodoPago — payment timing: PUE (single payment) or PPD (installments / deferred) |
| 70 | `sat_tipo_comprobante` | SAT catalog c_TipoDeComprobante — CFDI document type: I=ingreso, E=egreso, P=pago, T=traslado, N=nómina |
| 71 | `sat_moneda` | SAT catalog c_Moneda (subset) — currencies accepted in CFDI 4.0: MXN, USD, EUR, XXX |
| 72 | `sat_clave_prod_serv` | SAT catalog c_ClaveProdServ — product and service classification codes (e.g. `81161700` for internet access) required on every CFDI 4.0 line item |
| 73 | `sat_clave_unidad` | SAT catalog c_ClaveUnidad — unit-of-measure codes (e.g. `E48` for service unit, `H87` for piece) required on every CFDI 4.0 line item |
| 74 | `cfdi_documents` | Core CFDI 4.0 fiscal document records linked to invoices, credit notes, and payments — stores folio fiscal UUID, XML, PDF URL, PAC stamping metadata, SAT status, and receiver snapshot |
| 75 | `cfdi_related_documents` | CfdiRelacionados rows per CFDI document — records relationships between CFDIs (e.g. credit note referencing original invoice, substitution of cancelled CFDI) |
| 76 | `cfdi_payment_complements` | Complemento de Pago 2.0 headers — one per payment event for PPD invoices; records payment date, payment form, amounts, and bank details |
| 77 | `cfdi_payment_complement_items` | DoctoRelacionado rows per Complemento de Pago — links each payment event to the specific PPD invoices being settled with balance tracking |
| 78 | `cfdi_payment_complement_item_taxes` | Per-DoctoRelacionado tax breakdown (ImpuestosP) for Complemento de Pago 2.0 — one row per `<Traslado>` or `<Retencion>` inside a payment complement item; stores tax type, SAT tax code, rate type, rate, taxable base, and calculated tax amount |
| 79 | `cfdi_conceptos` | CFDI 4.0 concept (line item) rows — one per `<Concepto>` node; stores SAT product/service key, unit key, quantity, description, unit price, line total, optional discount, and ObjetoImp indicator |
| 80 | `cfdi_concepto_impuestos` | Per-line tax breakdown for CFDI 4.0 — one row per `<Traslado>` or `<Retencion>` inside a concept; stores tax type, SAT tax code (ISR/IVA/IEPS), rate type, rate, taxable base, and calculated tax amount |
| 81 | `concession_titles` | IFT/CRT concession title registry — tracks title number, type, authorized services, spectrum bands, validity dates, and regulatory status for each organization |
| 82 | `regulatory_filings` | IFT/CRT periodic filing log — annual reports, quarterly stats, tariff registrations, QoS reports, and other LFTR-mandated submissions |
| 83 | `contract_templates_mx` | IFT/CRT-registered Carta de Adhesión templates — stores the registered standard contract model including registration number, version, body text, and approval status |
| 84 | `ift_statistical_reports` | Pre-aggregated IFT/CRT reporting snapshots — subscriber counts by speed tier/state/technology, average speeds, coverage municipalities, and revenue per reporting period (see [`docs/ift-statistical-report-schema-review.md`](docs/ift-statistical-report-schema-review.md) for the field-by-field validation against the IFT *Formato Estadístico* — UI/export work is gated on that review) |
| 85 | `factura_publica_invoices` | Factura pública (venta al público en general) periodic aggregation documents — when MX contracts have `facturar = FALSE`, their invoices are aggregated into a periodic factura pública per SAT InformacionGlobal (Periodicidad, Meses, Año); one row per organization per period |
| 86 | `factura_publica_invoice_items` | Junction table linking individual invoices from contracts with `facturar = FALSE` to their parent factura pública — each invoice belongs to at most one factura pública document |
| 87 | `payment_gateways` | Payment gateway provider configuration per organization (Stripe, Conekta, OpenPay, MercadoPago, PayPal, manual) — stores environment, encrypted credentials, webhook secrets, and provider-specific JSON config |
| 88 | `payment_transactions` | Raw gateway transaction log for every payment attempt — provider reference ID, gateway status, raw request/response payloads, webhook data, and idempotency key for auditing and reconciliation |
| 89 | `payment_retries` | Failed payment retry scheduler — tracks retry attempts with exponential backoff (4h → 24h → 72h) for failed payment_transactions; max 3 attempts |
| 90 | `recurring_payment_profiles` | Stored card / token per client for autopay (recurring charges) — gateway customer ID or card token, card brand, last four digits, expiry, and lifecycle status |
| 91 | `suspension_rules` | Configurable suspension rules per organization — days-past-due threshold, grace period, action (auto_suspend / notify_only / auto_disconnect), optional plan-ID scoping |
| 92 | `suspension_logs` | History of suspend / unsuspend / disconnect / reconnect events per contract — triggering rule, performer, RADIUS CoA sent/response, and linked invoice |
| 93 | `csd_certificates` | CSD (Certificado de Sello Digital) storage per organization for SAT CFDI 4.0 stamping — PEM-encoded public certificate, encrypted private key, SHA-256 fingerprint, and expiry monitoring |
| 94 | `pac_providers` | PAC (Proveedor Autorizado de Certificación) provider credentials and endpoint configuration per organization — supports Finkok, SW Sapien, Digicel, Comercio Digital, FacturAPI with sandbox/production environments |
| 95 | `webhooks` | Outbound webhook registrations per organization — target URL, HMAC signing secret, JSON event subscriptions, max retries, and timeout configuration |
| 96 | `webhook_deliveries` | Delivery log for outbound webhooks — HTTP status, response body, response time, attempt number, retry scheduling, and delivery outcome |
| 97 | `organization_users` | Pivot table linking users to organizations with per-organization roles (owner, admin, manager, technician, billing, readonly) — enables multi-tenant user membership |
| 98 | `plan_addons` | Catalog of plan add-ons available for sale per organization — static IP, extra IP block, extra bandwidth, equipment rental; price and billing cycle (monthly / one-time / yearly) |
| 99 | `contract_addons` | Add-ons attached to a specific client contract — references plan_addons catalog, stores contracted quantity, negotiated unit price, validity window, and lifecycle status |
| 100 | `speed_tests` | Speed test results from client portal, technician tools, automated probes, or external services — download/upload Mbps, latency, jitter, packet loss for SLA correlation |
| 101 | `ticket_sla_events` | SLA tracking events per support ticket — first-response time, resolution time, escalation, breach warnings, and breaches; pairs with sla_definitions for target comparison |
| 102 | `sms_logs` | SMS and WhatsApp notification logging per organization — complements email_logs for non-email channels; captures direction, provider, delivery status, cost, and timestamps |
| 103 | `revenue_summary` | Materialized revenue summary for MRR / churn / ARPU reporting — populated by a scheduled task (not a view); one row per organization per calendar month per currency |
| 104 | `network_health_snapshots` | Aggregated daily device uptime and link utilization snapshots — uptime %, avg/peak latency, avg/peak throughput in/out, packet loss, total downtime minutes |
| 105 | `cfdi_cancellations` | SAT CFDI cancellation audit trail — cancellation reason code (motivo 01–04), optional replacement UUID (folio_sustitucion), PAC response status, and raw acuse XML acknowledgement |
| 106 | `firerelay_nodes` | FireRelay cluster node registry — tracks node ID, API URL, status (active/draining/maintenance/offline), resource metrics (CPU/memory/disk), client and device counts; only used when `FIRERELAY_MODE = master` |
| 107 | `firerelay_client_routing` | Client-to-node routing map for FireRelay cluster — maps each `client_id` to the node that owns it; only used when `FIRERELAY_MODE = master` |
| 108 | `webhook_events` | Inbound payment gateway webhook events — stores raw event payloads from Stripe, Conekta, and other providers with deduplication via unique `(provider, provider_event_id)` constraint, processing status, and linked `payment_transactions` record after reconciliation |
| 109 | `idempotency_keys` | Idempotency key storage for payment charge requests — prevents duplicate charges when the same key is submitted more than once; keys expire after 24 hours; scoped per organization |
| 110 | `alert_rules` | Configurable monitoring alert rules per organization — defines metric thresholds (CPU, memory, signal, latency, packet loss, uptime), evaluation windows, severity levels, optional auto-outage creation, and notification channel routing (email/SMS/SSE/webhook) |
| 111 | `alert_events` | Triggered alert event log — records each time an alert rule fires with current vs threshold values, acknowledgement tracking, and resolution timestamps |
| 112 | `organization_sso_configs` | Per-organization SSO configuration — one row per (organization, provider_type); stores SAML 2.0 IdP metadata (entity ID, SSO URL, SLO URL, X.509 signing certificate, SP private key) and OIDC settings (issuer, client ID/secret, scopes); controls auto-provisioning behaviour and the default role for new SSO users |
| 113 | `organization_sso_group_mappings` | IdP group-to-role mapping — maps an exact IdP group name to a FireISP role (admin/manager/technician/billing/readonly) for a given SSO config; evaluated at login to assign the highest-ranked matching role |
| 114 | `sso_auth_states` | Short-lived OIDC authorization state / nonce store — holds the random `state` and `nonce` parameters generated at the start of an OIDC authorization-code flow; rows expire after 10 minutes; prevents CSRF and replay attacks |
| 115 | `organization_quotas` | Per-tenant resource quota table — stores optional upper bounds for `max_clients`, `max_devices`, `max_storage_mb`, and `max_scheduled_tasks`; a NULL limit means "unlimited"; absence of a row is also treated as unlimited |
| 116 | `organization_database_configs` | Per-tenant database isolation configuration — stores the `isolation_mode` (`shared` default, `isolated` opt-in) and, for isolated tenants, the target database host/port/name/user, encrypted password, SSL flag, and `last_verified_at` connectivity-check timestamp |
| 117 | `profeco_complaints` | PROFECO / CONCILIANET complaint register — one row per consumer complaint folio filed with Mexico's Procuraduría Federal del Consumidor; captures folio number, ISP–consumer resolution status, complaint category, service type, intake and resolution dates, staff attribution, and optional links to existing client and support-ticket records; enables quarterly regulatory filing |
| 118 | `ai_providers` | AI/LLM provider registry per organization — stores provider kind (`openai`, `azure_openai`, `anthropic`, `gemini`, `ollama`, `custom`), API endpoint, encrypted API key, model name, optional `embedding_model` for RAG, temperature, max tokens, active flag, and soft-delete support |
| 119 | `ai_policies` | Per-organization AI Reply Assistant policy — master on/off switch, dispatch mode (`draft_only`, `auto_send`, `suggest`), tone, PII-redaction flag, per-channel enable flags (email/ticket/portal), max draft length, and confidence threshold; one row per organization |
| 120 | `ai_phrase_library` | Curated phrase library for AI prompt enrichment — stores phrase text, category (`greeting`, `closing`, `technical`, `billing`, `escalation`, `other`), locale, optional variable placeholders (JSON), optional embedding vector ID in ChromaDB, and soft-delete support |
| 121 | `ai_forbidden_terms` | Forbidden-term guard list per organization — terms that must not appear in any AI-drafted reply; evaluated by `phraseLibraryService.validateDraft()` before dispatch; supports locale-scoping and soft-delete |
| 122 | `ai_reply_logs` | Immutable audit log of every AI-drafted reply — stores `ticket_id`, `provider_id`, `dispatch_mode`, `confidence_score`, `draft_text`, `final_text`, `cost_usd`, `tokens_used`, `pii_redacted` flag, `validation_passed` flag, `sent_at`, and `created_by`; internal `context_snapshot` and `prompt_hash` are never returned by the API |
| 123 | `contract_topology_paths` | Cached network topology paths for AI context — stores the materialized path from a contract's CPE through all intermediate devices to the backbone; used by `topologyContextService` to build the topology breadcrumb injected into AI prompts; invalidated on device/link/contract change |
| 124 | `client_groups` | Family/account grouping for shared billing or family plans — stores group name, `billing_mode` (`separate` or `shared`), optional `primary_client_id` billing owner, and soft-delete; clients link via `clients.client_group_id` |
| 125 | `client_custom_fields` | Unlimited per-client key/value custom fields (technician notes, internal tags, etc.) — unique on `(client_id, field_key)`, free-form `field_value`, with soft-delete |
| 126 | `leads` | Lead capture and prospect pipeline — name/contact, `source`, pipeline `status` (`new`→`won`/`lost`), estimated value, assigned agent, optional geocoded address, and `converted_client_id` linking to the client created on conversion |
| 127 | `service_orders` | Service order workflow — `order_number`, optional `client_id`/`lead_id`/`plan_id`/`contract_id`, `order_type`, simplified status machine (`new`→`in_process`→`done`, or `cancelled` from `new`/`in_process`; migration 380), assignment, and lifecycle timestamps (`started_at`, `completed_at`) |
| 128 | `service_order_tasks` | Onboarding checklist items per service order — `task_key`, `label`, `is_done`, completion attribution, and sort order; unique on `(service_order_id, task_key)` |
| 129 | `winback_campaigns` | Win-back campaigns for cancelled customers — name, status, `target_segment` cohort, offer description, retention `discount_percent`, optional message template, and date range |
| 130 | `client_interactions` | Manual client interaction log (calls, visits, chats) — `interaction_type`, `direction`, subject/notes, `occurred_at`, optional duration, and logging staff member; feeds the per-client activity timeline together with tickets, payments, and email/SMS logs |
| 131 | `follow_up_reminders` | Scheduled client follow-ups — title/notes, `priority`, `status` (`pending`/`completed`/`cancelled`), `due_at`, assignee, optional originating interaction or ticket, and `notified_at` stamp so the due notification fires once |
| 132 | `satisfaction_surveys` | NPS (0–10) / CSAT (1–5) surveys — client, optional ticket/interaction reference, `channel`, `status` (`pending`→`sent`→`responded`), score, respondent comment, and sent/responded timestamps |
| 133 | `ticket_escalations` | Escalation chain for unresolved tickets — auto-incrementing `level` per ticket, escalated by/to attribution (NULL `escalated_by` = automatic), reason, `status` (`open`→`acknowledged`→`resolved`), and resolution notes |
| 134 | `communication_campaigns` | Bulk campaign sends (email/SMS/WhatsApp) — `channel`, `status` (`draft`→`scheduled`→`sending`→`sent`/`cancelled`/`failed`), optional template and recipient filters (by client status, plan, or tag), aggregate counters (recipient, sent, delivered, opened, bounced, failed), scheduling timestamps, and `deleted_at` soft-delete |
| 135 | `campaign_messages` | Per-recipient record for every campaign dispatch — `campaign_id`, optional `client_id`, `recipient` (email or phone), `channel`, `status` (`queued`→`sent`→`delivered`→`opened`/`bounced`/`failed`), `provider_message_id` for webhook correlation, and individual timestamp fields (queued, sent, delivered, opened, bounced) |
| 136 | `client_dnd_preferences` | Per-customer per-channel Do Not Disturb preferences — `channel` (`email`/`sms`/`whatsapp`/`all`), `opt_out` flag for marketing/bulk sends, optional quiet-hours window (`quiet_hours_start`/`quiet_hours_end`), and free-form `reason`; unique on `(client_id, channel)` |
| 137 | `plan_throttle_logs` | Audit log for FUP throttle and restore actions per contract — records throttle/restore events, RADIUS CoA sent/response, and reason (fup/overage/manual) |
| 138 | `plan_speed_windows` | Time-based speed windows for plans — bitmask day-of-week scheduling, start/end time, per-window download/upload speeds, and priority ordering for overlap resolution |
| 139 | `organization_invoice_settings` | Per-org invoice branding — logo URL, header color, footer legal text, and payment instructions used by the PDF invoice generator |
| 140 | `late_fee_rules` | Configurable late fee policies per organization — flat or percent fee, grace period, maximum applications, and active flag |
| 141 | `invoice_late_fees` | Audit trail of late fee applications to overdue invoices — links to the rule, the created line item, and the performer (NULL = system) |
| 142 | `payment_reminder_settings` | Per-org payment reminder schedule — days before/after due date and on-due-date send flags, with enabled toggle |
| 143 | `payment_reminder_logs` | Idempotency log for sent payment reminders — unique on `(invoice_id, stage, channel)` to prevent duplicate sends |
| 144 | `payment_plans` | Payment plan for splitting invoices into installments |
| 145 | `payment_plan_installments` | Individual installment records for a payment plan |
| 146 | `cash_reconciliation_sessions` | Field agent cash collection reconciliation sessions |
| 147 | `refund_requests` | Refund request workflow — create, review (approve/reject), process (credit balance, credit note, or gateway refund) |
| 148 | `billing_disputes` | Billing dispute tracking with status lifecycle (open → investigating → resolved) |
| 149 | `dispute_evidence` | File attachments for billing disputes (reuses multer upload infrastructure) |
| 150 | `chargebacks` | Chargeback management; auto-created from gateway webhook dispute events |
| 151 | `billing_adjustments` | Immutable billing adjustment log — written by refund processing, chargeback resolution, and manual admin actions; mirrors to audit_logs |
| 152 | `radcheck` | Standard FreeRADIUS per-user check attributes (Cleartext-Password, Auth-Type, TLS-Cert-Serial) — populated by `radius_sync` task from FireISP state |
| 153 | `radreply` | Standard FreeRADIUS per-user reply attributes — populated by `radius_sync` task |
| 154 | `radusergroup` | Standard FreeRADIUS user → group membership — maps each subscriber username to their plan group |
| 155 | `radgroupcheck` | Standard FreeRADIUS per-group check attributes |
| 156 | `radgroupreply` | Standard FreeRADIUS per-group reply attributes — contains vendor speed attributes (MikroTik/Cisco/Juniper/WISPr) generated per plan by `radiusAttributeService` |
| 157 | `subscriber_certificates` | EAP-TLS subscriber certificate metadata registry — CN, serial, SHA-256 fingerprint, validity window, and revocation tracking; FireISP stores metadata only (no CA/key generation) |
| 158 | `plan_access_windows` | Per-plan time-based access restriction windows (day_mask + start/end time); converted to FreeRADIUS `Login-Time` radgroupcheck attribute by `syncFreeradiusTables()` |
| 159 | `organization_walled_garden_settings` | Per-org walled garden configuration: enabled flag, captive portal redirect URL, MikroTik address-list name, allowed destinations for NAS ACL reference |
| 160 | `radius_account_routes` | Per-RADIUS-account static route injection; each non-deleted row becomes one `Framed-Route` radreply attribute (`destination [gateway] [metric]`) during sync |
| 161 | `mac_move_events` | MAC move event log — written by accounting ingest when the same RADIUS username is seen from a different Calling-Station-Id or NAS between sessions |
| 162 | `pppoe_service_profiles` | PPPoE AC / BNG service profiles — MTU, MRU, auth-methods, DNS, session/idle timeouts, rate-limit override (MikroTik), address-list, Filter-Id; referenced by `ip_pools.service_profile_id` and `radius.service_profile_id` |
| 163 | `radpostauth` | FreeRADIUS post-authentication log — written directly by FreeRADIUS via `rlm_sql`; read by FireISP for auth-failure diagnostics (no foreign keys) |
| 164 | `pppoe_event_logs` | PPPoE stage event log (PADI/PADS/LCP/IPCP/AUTH/PADT); written by a syslog shipper via `POST /pppoe/events`; read for MTU diagnostics and LCP failure detection (no FKs on org/NAS — loose coupling) |
| 165 | `dhcp_servers` | DHCP server connection registry (ISC Kea, MikroTik); stores host, port, API URL, and encrypted API token for each DHCP server managed by FireISP |
| 166 | `dhcp_static_reservations` | Static DHCP reservations binding MAC addresses to IP addresses; supports DHCP Option 82 circuit/remote-id binding for subscriber identification |
| 167 | `nat_pools` | CGNAT, 1:1 NAT, and PAT pool definitions; tracks external IP ranges, port allocation ranges, and max ports per subscriber |
| 168 | `ptr_records` | Reverse DNS PTR record management; supports both IPv4 and IPv6 PTR records with configurable TTL and DNS zone |
| 169 | `ra_guard_policies` | RA Guard policy assignments to switch ports; prevents rogue Router Advertisement attacks by restricting RA forwarding to authorized ports |
| 170 | `tunnel_6rd_configs` | 6rd (IPv6 Rapid Deployment) tunnel configuration; maps IPv4 prefixes to IPv6 prefixes for rapid IPv6 rollout over IPv4 infrastructure |
| 171 | `ds_lite_configs` | DS-Lite AFTR (Address Family Transition Router) configuration; enables IPv4 connectivity for subscribers on IPv6-only access networks |
| 172 | `map_rules` | MAP-E and MAP-T rule definitions; provides stateless IPv4/IPv6 address mapping for scalable IPv4 address sharing |
| 173 | `xlat464_configs` | 464XLAT PLAT/CLAT configuration; enables IPv4 application connectivity in IPv6-only subscriber networks via stateful NAT64 |
| 174 | `device_groups` | Logical device groupings (§6.1) — organize network devices by type, location, region, or OLT for bulk operations and filtered monitoring views |
| 175 | `device_group_members` | Junction table linking devices to device groups (§6.1) — many-to-many with cascade deletes |
| 176 | `discovery_scans` | Network discovery scan jobs (§6.1) — CIDR-range SNMP probes with full SNMPv3 credential support, scan state tracking, and host counters |
| 177 | `discovery_results` | Per-host results from discovery scans (§6.1) — stores sysDescr/sysOID, auto-matched SNMP profile, and onboarding status (pending_review/onboarded/ignored) |
| 178 | `snmp_trap_forwarding_rules` | Configurable SNMP trap routing rules (§6.1) — match by trap_type/source_ip/OID prefix and forward to HTTP URL, email, or registered webhook |
| 179 | `poller_nodes` | Registry of dedicated SNMP poller nodes (§6.4) — each node tracks queue depth, poll duration, heartbeat; may reference a firerelay_nodes entry for distributed polling |
| 180 | `device_polling_configs` | Per-device or per-device-type polling overrides (§6.4) — poll interval, SNMP GETBULK flags, timeout, retries, failover node, adaptive polling thresholds |
| 181 | `poller_performance_snapshots` | Time-series poller health metrics (§6.4) — snapshot of devices polled/failed, avg/max duration, queue depth, timeout rate per poller node |
| 182 | `alert_escalation_chains` | Named L1→L2→L3 escalation chains (§6.5) — top-level chain definition, org-scoped, referenced by alert_rules.escalation_chain_id |
| 183 | `alert_escalation_steps` | Individual escalation steps within a chain (§6.5) — ordered by step_number with delay_minutes, notification channel (email/sms/whatsapp/telegram/webhook), and recipient config |
| 184 | `maintenance_windows` | Scheduled maintenance windows for alert suppression (§6.5) — can target a specific device or site; supports one-time and recurring (cron) windows |
| 185 | `alert_notification_channels` | Multi-channel notification routing configs (§6.5) — channel_type enum, credentials AES-256-GCM encrypted in config_encrypted column |
| 186 | `alert_suppression_rules` | Upstream→downstream device correlation suppression (§6.5) — when upstream has a triggered alert, suppress downstream alerts for suppress_duration_minutes |
| 187 | `config_templates` | Device configuration templates with {{variable}} placeholders (§6.6) — optional device_type/manufacturer filter for deployment targeting |
| 188 | `config_deployment_records` | Config template push records (§6.6) — tracks status, variables used, result output, and deployed_at per device per deployment |
| 189 | `config_backup_schedules` | Per-device or per-org config backup schedules (§6.6) — extends the global nightly task with custom cron expressions per device |
| 190 | `config_compliance_rules` | Config compliance audit rules (§6.6) — keyword/regex rules (must_contain, must_not_contain, regex_match, regex_not_match) with severity levels |
| 191 | `config_compliance_results` | Config compliance audit results (§6.6) — pass/fail/error per rule per backup, indexed by device and evaluation time |
| 192 | `olt_ports` | PON and uplink port inventory per OLT device (§7.1) — slot/port index, port type (gpon/epon/xgspon/uplink), admin/oper state, ONU count, Tx/Rx optical power, bandwidth utilization, last_polled_at |
| 193 | `onu_profiles` | PON service profile templates (§7.2) — T-CONT ID, DBA profile name, assured/max bandwidth, GEM port ID, service/client VLAN, VLAN mode (transparent/tag/translate/double_tag/untagged), linked plan |
| 194 | `onu_details` | GPON/EPON ONU detail extension to devices (§7.2) — serial number, LOID/password (encrypted at app layer), onu_state (online/offline/los/dying_gasp/power_off/loc/unconfigured), OLT-assigned onu_id, ranging distance, line/service profile names, WAN mode, last provision job link |
| 195 | `onu_optical_metrics` | Per-ONU optical diagnostic time-series (§7.2) — Tx power (dBm), Rx power (dBm), temperature (°C), voltage (V), bias current (mA), OLT-side Rx power; no FKs (metrics write pattern), 90-day retention via nightly cleanup |
| 196 | `onu_whitelist` | ONU MAC/SN allow-block list per OLT (§7.2) — entry_type (mac/serial_number), entry_value, list_type (allow/block); unique on (olt_device_id, entry_type, entry_value) |
| 197 | `onu_omci_configs` | OMCI/TR-069 Wi-Fi and WAN config records per ONU (§7.2) — config_type, Wi-Fi SSID/band/channel/security, Wi-Fi password (encrypted at app layer), WAN mode/IP mode/addresses, delivery_method (omci/tr069/ssh_cli/manual/pending), apply_status, raw_config JSON |
| 198 | `onu_firmware_jobs` | ONU firmware upgrade and reboot job scheduler (§7.2) — job_type (firmware_upgrade/reboot/provision/factory_reset), scope (single_onu/olt_port/olt_device/region), firmware URL and version, scheduled_at, status, per-device result_summary JSON; background job processor dispatches pending jobs |
| 199 | `olt_vendor_capabilities` | Per-vendor OLT management capability matrix (§7.1) — vendor, model_pattern, protocols JSON array (snmp/tl1/netconf/ssh_cli), snmp_profile_name, CLI template references, NETCONF schema, OMCI support flag, enterprise OID root; global (not org-scoped); seeds for Huawei/ZTE/VSOL/C-Data/WOLCK/Calix |
| 200 | `olt_splitters` | PON splitter inventory (§7.1) — ratio (1:2 through 1:128), splitter_type (optical/wdm), linked to site and OLT port, installation date, status (active/inactive/damaged/removed) |
| 201 | `onu_migration_jobs` | ONU port migration job records (§7.3) — transactional ONU reassignment from source to target PON port, status lifecycle (pending/queued/in_progress/completed/failed/cancelled), scheduled_at, result_detail JSON |
| 202 | `fiber_routes` | Fiber route path records (§7.4) — CO-to-splitter-to-ONU paths, route_type (trunk/distribution/drop/feeder/other), parent_route_id self-FK for hierarchical routes, from/to device/port/ONU/splitter FKs, total_length_m, fiber_count, gis_path JSON |
| 203 | `odf_frames` | Optical Distribution Frame inventory (§7.4) — ODF frame per site, total_ports, frame_type, manufacturer/model, status (active/inactive/damaged/removed) |
| 204 | `odf_ports` | ODF port records within an ODF frame (§7.4) — port_number (unique per frame), connector_type (sc/lc/fc/st/mpo/other), fiber_route_id link, status; CASCADE deletes when frame is removed |
| 205 | `odf_cross_connects` | ODF cross-connect patch cord records (§7.4) — port_a_id and port_b_id FKs (RESTRICT delete), patch_cord_type, patch_cord_length_m, status (active/inactive/removed) |
| 206 | `otdr_test_results` | OTDR test result records (§7.4) — fault_detected flag, fault_distance_m, fault_type (fiber_break/splice_loss/connector_loss/bend_loss/reflection/other), events JSON, sor_file_path, job_status (pending/running/completed/failed) |
| 207 | `sfp_inventory` | SFP transceiver lifecycle tracking (§7.4) — form_factor (sfp/sfp_plus/sfp28/qsfp/qsfp_plus/xfp/gbic/other), vendor/part/serial, wavelength_nm, max_distance_km, lifecycle_status (installed/spare/faulty/retired), links to devices and inventory_items; DDM diagnostics via snmp_metrics sfp_* columns |
| 208 | `cpe_devices` | TR-069/CWMP CPE device registry (§8.1) — serial_number+OUI (unique), acs_username/password_hash for HTTP Basic auth, status ENUM (new/provisioning/active/error/offline), last_inform_at/ip, wan_ip, lan_subnet, wifi_ssid; FKs to organizations, devices, contracts, cpe_profiles |
| 209 | `cpe_parameters` | TR-069 parameter tree per CPE (§8.1) — parameter_path (up to 512 chars), parameter_value TEXT, is_writable flag, last_fetched_at; UNIQUE on (cpe_device_id, parameter_path(255)); CASCADE on device delete |
| 210 | `cpe_tasks` | Queued CWMP tasks per CPE device (§8.1) — task_type ENUM (get/set parameter values, download, reboot, factory_reset, etc.), parameters JSON, status (queued/in_progress/done/failed), priority TINYINT (1=highest), result/error JSON |
| 211 | `cpe_profiles` | CPE provisioning profile templates with inheritance (§8.2) — parent_profile_id self-FK for up to 5-level chain, plan_id for auto-apply, manufacturer/model filters, wifi_ssid_template with {{serial}} substitution, parameters JSON for static push |
| 212 | `cpe_parameter_mappings` | Automatic parameter mapping rules for CPE profiles (§8.2) — source_type ENUM (static/contract_field/plan_field/device_field), static_value or source_field; CASCADE on profile delete |
| 213 | `cpe_firmware_versions` | Firmware version inventory per CPE model (§8.1) — manufacturer+model+version (unique), firmware_url, file_size_bytes, checksum/checksum_type (md5/sha1/sha256), is_stable flag |
| 214 | `cpe_firmware_campaigns` | Batch firmware upgrade campaigns (§8.1) — target by manufacturer/model/profile/ad-hoc device IDs JSON, status (scheduled/running/done/failed/cancelled), progress counters (total/completed/failed_devices), result_summary JSON |
| 215 | `cpe_diagnostics` | TR-069 diagnostic snapshots (§8.3) — stores ping/traceroute/wifi_snapshot/ethernet_status/wan_diagnostics results keyed by cpe_device_id; result JSON, diag_type ENUM, status (pending/running/completed/failed), target_host for active probes |
| 216 | `cpe_session_logs` | ACS CWMP session event log (§8.3) — records inform/task_dispatched/task_response/fault/auth_failure/parse_error/session_error events with raw_body (truncated to 2000 chars) for CWMP debugging and compliance audit; cleaned up by scheduled task |
| 217 | `cpe_lifecycle_history` | Immutable CPE lifecycle state transition audit trail (§8.4) — records every in_stock/assigned/active/returned/rma transition with previous_state, new_state, actor_id, and free-text reason for inventory accountability |
| 218 | `ap_channel_plans` | Channel assignment registry per site (§9.1) — frequency_mhz, channel_width_mhz, status (active/inactive); FK to sites; used for conflict avoidance across AP sectors |
| 219 | `ap_sector_configs` | AP/PTP wireless RF configuration per sector device (§9.1) — sector_azimuth_deg, sector_width_deg, frequency_mhz, channel_width_mhz, tx_power_dbm, encryption ENUM, channel_plan_id, antenna_gain_dbi, height_m, polarization ENUM, max_clients; FK to devices + ap_channel_plans |
| 220 | `wireless_client_sessions` | Append-only CPE client state snapshots per AP poll (§9.1) — mac_address, ip_address, signal_dbm, noise_floor_dbm, snr_db, ccq_pct, tx_rate_mbps, rx_rate_mbps, distance_m, last_seen_at; FKs to devices (AP + CPE, SET NULL on delete) |
| 221 | `ap_command_jobs` | Remote AP command jobs for power/frequency/reboot adjustments (§9.1) — command_type ENUM (set_tx_power/set_frequency/set_channel_width/reboot/other), target_value, status ENUM (pending/queued/in_progress/completed/failed/cancelled), scheduled_at, result_output, error_message; FK to devices |
| 222 | `wireless_channel_interference` | Detected RF channel interference records per sector/site (§9.1) — detected_at, frequency_mhz, channel_width_mhz, interference_level ENUM (low/medium/high/critical), conflicting_ap_mac; FKs to ap_sector_configs + sites (SET NULL on delete) |
| 223 | `link_planning_calcs` | Saved link budget calculator runs (§9.2) — site_a/b FKs or lat/lon overrides, frequency_mhz, tx_power_dbm, antenna gains, cable loss; computed distance_km, fspl_db, fresnel_radius_m, clearance_required_m, link_budget_db stored for history display |
| 224 | `spectrum_scan_results` | AP spectrum scan results (§9.3) — device_id, scan_type ENUM (scheduled/manual/triggered), frequency_start/end_mhz, channel_width_mhz, scan_data JSON array of {freq_mhz, power_dbm} objects, peak_interference_dbm, recommended_channel_mhz, status ENUM; FK to devices (RESTRICT on delete) |
| 225 | `quality_classes` | QoS priority class registry (§10.1) — traffic_type ENUM (voip/video/web/download/other), priority 1–8, DSCP mark, MikroTik queue kind, max_limit_pct; linked from plans.priority_class_id |
| 226 | `queue_tree_nodes` | Hierarchical queue tree node definitions (§10.1/§10.4) — parent_id self-FK for tree structure, queue_type ENUM (tree/simple/cbq/hfsc/pcq), vendor_platform ENUM (mikrotik/cisco/juniper/generic), NAS interface, max/burst/threshold limits, burst_time_seconds, queue_kind, sort_order; exportable as MikroTik RouterOS script |
| 227 | `rate_limit_templates` | Named rate-limit templates per service type (§10.2) — service_type ENUM (pppoe/dhcp/hotspot/static/other), radius_vendor ENUM (mikrotik/cisco/juniper/generic), CIR + burst + threshold speeds, cached rate_string |
| 228 | `protocol_shaping_rules` | Per-protocol/port traffic shaping rules (§10.2) — protocol/direction/port-range/L7-pattern match, action ENUM (limit/drop/mark/throttle), rate limits, DSCP mark, enabled flag, preset name; optional FK to plans |
| 229 | `data_rollover_balances` | Monthly data rollover balance ledger per contract (§10.3) — billing_month, accrued_gb, consumed_rollover_gb, carry_forward ENUM (yes/no); UNIQUE KEY on contract_id + billing_month; FK to contracts (CASCADE) |
| 230 | `data_packs` | Add-on data packs for purchase by subscribers (§10.3) — data_gb, price, validity_days, status ENUM (active/inactive/deprecated); org-scoped |
| 231 | `data_pack_purchases` | Subscriber data pack purchase records (§10.3) — contract_id FK (CASCADE), pack_id FK (RESTRICT), purchased_by (admin/client_portal), activated_at, expires_at, status ENUM; links contracts to data_packs |
| 232 | `fup_usage_notifications` | FUP threshold notification audit log (§10.3) — contract_id, billing_month, threshold_pct (80/90/100), used_gb, cap_gb, notified_at; UNIQUE KEY on contract_id + billing_month + threshold_pct prevents duplicate alerts |
| 233 | `interface_qos_policies` | Per-interface QoS policy definitions (§10.4) — algorithm ENUM (htb/cbq/hfsc/pcq/prio/sfq/generic), direction ENUM (ingress/egress/both), parent_policy_id self-FK, bandwidth_mbps/ceil_mbps/burst_mbps, vendor_platform ENUM; FK to devices (SET NULL) |
| 234 | `mpls_vlan_prioritization_rules` | MPLS label and VLAN 802.1p/802.1q traffic prioritization rules (§10.4) — rule_type ENUM (vlan/mpls/qinq/mpls_vlan), vlan_id, mpls_label, inner_vlan_id, traffic_class, priority_bits (0–7), dscp_value, queue_class, enabled flag |
| 235 | `dscp_marking_policies` | DSCP traffic marking and remarking rules (§10.4) — traffic_class, dscp_value (0–63), dscp_name (EF/AF41/CS3/BE), match_protocol, match_port_range, action ENUM (mark/remark/passthrough), priority, enabled; org-scoped with 4 default seeds |
| 236 | `bandwidth_test_servers` | Registered iperf3/speedtest bandwidth test server endpoints (§10.4) — host, port, protocol ENUM (tcp/udp/iperf3/speedtest), region, site_id FK (SET NULL); status ENUM (active/inactive/maintenance) |
| 237 | `subscriber_speed_test_jobs` | Subscriber bandwidth test job queue (§10.4) — contract_id FK (CASCADE), server_id FK (SET NULL), status ENUM (pending/running/completed/failed/cancelled), scheduled_at, started_at, completed_at, download_mbps, upload_mbps, latency_ms, jitter_ms, test_log |
| 238 | `portal_service_requests` | Client portal self-service requests (§11.3) — request_type ENUM (plan_upgrade/wifi_password_change/pppoe_password_change/static_ip_request/cancellation/visit_schedule), status ENUM (pending/approved/rejected/completed/cancelled), payload JSON, proration fields, approved_by, completed_at |
| 239 | `portal_kb_articles` | Knowledge-base / FAQ articles surfaced in the client portal (§11.4) — category, title, slug (UNIQUE per org), body LONGTEXT, is_published, view_count, helpful_yes, helpful_no |
| 240 | `portal_chat_sessions` | AI chatbot sessions started from the client portal (§11.4) — session_token UNIQUE, messages JSON array, status ENUM (active/resolved/escalated), ticket_id FK (created on escalation), turn_count |
| 241 | `portal_push_subscriptions` | Web Push notification subscriptions for portal clients (§11.5) — endpoint, p256dh, auth, notify_outage/billing/ticket flags |
| 242 | `ticket_time_logs` | Per-ticket time tracking entries (§12) — user_id FK, minutes (duration), work_date, description; linked to tickets CASCADE |
| 243 | `ticket_relations` | Typed relationships between tickets (§12) — duplicate/related/blocks/blocked_by; UNIQUE on (ticket_id_a, ticket_id_b, relation_type); both FKs CASCADE |
| 244 | `ticket_ai_triage` | AI-generated triage results per ticket (§12) — suggested_category, suggested_priority, suggested_resolution, kb_article_ids JSON, context_snapshot JSON; UNIQUE on ticket_id |
| 245 | `work_orders` | Field work orders linked to tickets or standalone (§12) — org-scoped, assigned_to technician, status ENUM (pending/assigned/in_progress/completed/cancelled), GPS coordinates, soft-delete |
| 246 | `work_order_materials` | Material usage log per work order (§12) — item_name, quantity DECIMAL, unit, unit_cost; FK to work_orders CASCADE |
| 247 | `technician_gps_breadcrumbs` | GPS position log for field technicians (§12) — append-only, no FKs (write-hot), user_id, lat/lng DECIMAL(10,7), accuracy_m FLOAT, recorded_at; composite index on (user_id, recorded_at DESC) |
| 248 | `ticket_attachments` | File attachments for support tickets (§12) — filename, original_filename, mime_type, file_size, storage_path, uploaded_by; FK to tickets CASCADE, org-scoped |
| 249 | `work_order_attachments` | File attachments for work orders (§12) — filename, original_filename, mime_type, file_size, storage_path, uploaded_by; FK to work_orders CASCADE, org-scoped |
| 250 | `map_geofences` | Geofence zones (§13.2) — polygon boundary (GeoJSON) or radius-based circle; optional device_id pin; is_active flag; triggers geofence_evaluation task alerts |
| 251 | `map_infrastructure_points` | Infrastructure map pins (§13.2) — towers, cabinets, ODFs, splice closures, poles, POPs; lat/lng, site_id FK, properties JSON, is_active |
| 252 | `fiber_route_segments` | Fiber route polyline sub-segments (§13.2) — ordered sequence within a parent fiber_route, GeoJSON LineString coordinates, cable type, burial type, fiber count |
| 253 | `device_dependency_edges` | Device parent-child dependency graph edges (§13.3) — directed parent-child relationship for cascade visualization and impact analysis; dependency_type ENUM, is_redundant flag |
| 254 | `vendors` | Vendor/supplier registry (§14.2) — contact info, payment terms, currency, status; org-scoped with soft-delete |
| 255 | `purchase_orders` | Purchase orders to vendors (§14.2) — po_number, status ENUM draft/sent/partial/received/cancelled, line items, subtotal/tax/total, destination warehouse; org-scoped with soft-delete |
| 256 | `purchase_order_items` | Line items within a purchase order (§14.2) — inventory_item_id FK, description, quantity_ordered, quantity_received, unit_cost; total_cost GENERATED STORED column |
| 257 | `assets` | Individual trackable assets with serial numbers (§14.2/§14.3) — asset_tag, barcode, lifecycle_status ENUM, warranty_expires_at, depreciation_method ENUM, purchase_date/cost, disposal fields; FKs to vendors/warehouses/purchase_orders |
| 258 | `asset_assignments` | Equipment-to-customer and equipment-to-device assignments (§14.3) — client_id/device_id/port_name assignment targets, assigned_at/returned_at lifecycle, assigned_by/returned_by users |
| 259 | `rma_requests` | Return Merchandise Authorization workflow (§14.2) — rma_number, status ENUM open/shipped/received/replacement_sent/closed/denied, reason ENUM, replacement_asset_id FK; linked to assets and vendors |
| 260 | `report_definitions` | Report template registry (§15.5) — name (unique per org), description, report_type ENUM (financial/operational/network/compliance/custom), parameters JSON schema, output_formats JSON, is_public, soft-delete |
| 261 | `scheduled_reports` | Scheduled report delivery (§15.5) — links to report_definitions, format ENUM (csv/xlsx/pdf), cron_expression, recipients JSON array, last_run_at, last_status, next_run_at, soft-delete |
| 262 | `generated_reports` | Report generation history (§15.5) — immutable log of each generated report with file_path, file_size, status, generation_time_ms; FK to scheduled_reports (nullable) |
| 263 | `dashboard_widgets` | Analytics dashboard widget layout (§15.5) — widget_type ENUM (revenue_chart/subscriber_growth/aging_summary/capacity_forecast/top_consumers/uptime_summary/bandwidth_utilization/custom_metric), per-user position/size grid, config JSON, is_visible |
| 264 | `custom_reports` | User-built custom reports (§15.5) — name, query_type ENUM (sql/visual), sql_query TEXT (SELECT-only, validated), visual_config JSON, is_public, last_run_at; public reports visible to all org members |
| 265 | `subscriber_consents` | §16.2 LFPDPPP consent tracking (Aviso de Privacidad) — consent version, purpose, granted/withdrawn timestamps, IP address, and legal basis per subscriber per org |
| 266 | `dsar_requests` | §16.2 DSAR/ARCO request workflow with 30-day deadline — request type (access/rectification/cancellation/opposition), status lifecycle, legal hold flag, fulfillment notes, and assigned reviewer |
| 267 | `identity_verification_records` | §16.2 INE/IFE/CURP identity verification with checksum — document type, document number, CURP, verification method, verification date, verifier user, and outcome status |
| 268 | `gov_data_requests` | §16.3 Tamper-proof log of government data requests (lawful interception) — authority name, legal basis, request date, data scope, response date, SHA-256 row_hash integrity chain |
| 269 | `phone_number_inventory` | §16.4 VoIP/DID phone number inventory — E.164 number, number type ENUM (did/toll_free/local/mobile), carrier, status ENUM (available/assigned/porting/reserved), assigned client FK |
| 270 | `number_portability_records` | §16.4 MNP/FNP portability records — porting direction (in/out), donor/recipient carrier, port-in/port-out dates, status lifecycle, regulatory reference number |
| 271 | `numbering_blocks` | §16.4 CNMC numbering block management — block prefix, range start/end, block size, assigned carrier, regulatory authority, allocation date, and utilization tracking |
| 272 | `uso_obligations` | §16.6 Universal service obligation tracking — obligation type, reporting period, contribution amount, payment status, regulatory filing reference, and compliance deadline |
| 273 | `rural_coverage_reports` | §16.6 Rural deployment and social coverage reporting — municipality code, coverage percentage, technology type, underserved flag, population covered, and reporting period |
| 274 | `service_modification_notices` | §16.7 Mandatory service modification notice tracking — modification type, effective date, notice sent date, notice period days, regulatory requirement reference, and affected contracts count |
| 275 | `data_residency_config` | §16.8 Data localization and residency compliance config — storage region, backup region, cross-border transfer allowed flag, transfer legal basis, ATDT/CRT rule reference, and last reviewed date |
| 276 | `report_access_logs` | §16.9 Who accessed/downloaded what subscriber data — user ID, report type, data scope, access timestamp, IP address, export format, and row count for regulatory audit trail |
| 277 | `webauthn_credentials` | §17.1 WebAuthn/FIDO2 hardware key credential storage — credential_id (opaque handle), public_key, AAGUID, transports JSON; org + user scoped with soft-delete |
| 278 | `admin_ip_allowlist` | §17.1 Org-scoped IP/CIDR allowlist for admin portal access — ip_address (IPv4/CIDR), is_active, optional expiry timestamp |
| 279 | `password_policies` | §17.1 Per-org password policy — min/max length, uppercase/lowercase/digits/symbols flags, rotation_days, history_count, lockout_attempts + duration; unique per org |
| 280 | `api_key_rate_limits` | §17.2 Per-token rate limits — requests_per_minute/hour/day and burst_size; unique per org+token with ON DUPLICATE KEY UPDATE upsert |
| 281 | `firewall_rules` | §17.3 Subscriber/org firewall rule management — action ENUM(allow/deny/log), protocol ENUM, src/dst IP + port, direction ENUM, priority, soft-delete |
| 282 | `ddos_protection_rules` | §17.3 Flowspec/RTBH DDoS mitigation rules — rule_type ENUM(flowspec/rtbh), target_prefix, action ENUM(drop/ratelimit/redirect), threshold PPS/BPS, triggered_at, deactivated_at |
| 283 | `blackhole_routes` | §17.3 RTBH blackhole routing — target_prefix, reason, next_hop, is_active flag, released_at timestamp; create activates route, release endpoint clears it |
| 284 | `dns_blocklists` | §17.3 DNS blocklist entries for malware/phishing/botnet/ads blocking — domain, category ENUM, source, is_active; scoped per org |
| 285 | `cpe_security_scans` | §17.3 CPE security scan records — scan_type ENUM(default_credentials/open_ports/firmware_cve/configuration_audit/full), status ENUM(pending/running/completed/failed), device/cpe references, started_at, completed_at, results JSON |
| 286 | `encryption_key_metadata` | §17.4 Encryption key lifecycle registry — key_alias, algorithm, key_size, purpose, status ENUM(active/retired/revoked), created_by FK→users, rotated_at, expires_at, notes |
| 287 | `data_masking_rules` | §17.4 Column-level data masking configuration — table_name, column_name, masking_type ENUM(full/partial/hash/tokenize), mask_pattern, roles_exempt JSON, is_active; unique per org+table+column |
| 288 | `secure_deletion_log` | §17.4 Audit trail for GDPR/LFPDPPP secure deletion runs — table_name, records_deleted, policy_applied, deletion_method, details JSON, triggered_by FK→users |
| 289 | `automation_rules` | §18.1 Event-triggered workflow rules — trigger_event, trigger_conditions JSON, action_type, action_config JSON, priority, is_enabled; soft-delete |
| 290 | `automation_rule_executions` | §18.1 Audit log for automation rule runs — trigger_payload JSON, status ENUM(success/failure/skipped), result_message, duration_ms |
| 291 | `batch_jobs` | §18.1 Bulk subscriber operation jobs — operation ENUM(suspend/unsuspend/rate_limit/…), filter_criteria JSON, total/processed/success/failed item counts |
| 292 | `batch_job_items` | §18.1 Per-entity result for each batch job — entity_type ENUM(contract/client/device), entity_id, status, result_message |
| 293 | `provisioning_pipelines` | §18.1 Ordered provisioning pipeline runs — stages_config JSON, stages_results JSON, current_stage, contract_id/client_id optional FKs |
| 294 | `provisioning_pipeline_stages` | §18.1 Individual stage records within a pipeline run — stage_order, stage_name, input_data/output_data JSON, started_at/completed_at |
| 295 | `remediation_rules` | §18.1 Auto-remediation rules — condition_metric, condition_operator ENUM(gt/lt/gte/lte/eq/neq/is_true), condition_threshold, cooldown_minutes, action_type; soft-delete |
| 296 | `remediation_executions` | §18.1 Auto-remediation execution records — status ENUM(queued/success/failure/stubbed DEFAULT stubbed), error_message |
| 297 | `automation_scripts` | §18.2 Script storage — language ENUM(bash/python/powershell/javascript), script_body LONGTEXT (NEVER executed via child_process), version, is_shared, tags JSON, api_endpoint |
| 298 | `script_executions` | §18.2 Script execution log — status ENUM(queued/running/success/failure/cancelled DEFAULT queued), stdout/stderr LONGTEXT, exit_code (populated by real sandboxed executor) |
| 299 | `router_driver_configs` | §18.3 Vendor router API configs — vendor ENUM(mikrotik/cisco_ios/cisco_iosxe/juniper_junos/zte/huawei/generic_rest), protocol, encrypted_password/api_token (AES-256-GCM); soft-delete |
| 300 | `device_command_executions` | §18.3 Router command dispatch log — command, params JSON, status ENUM(queued/success/failure/stubbed), response JSON, duration_ms |
| 301 | `analytics_anomalies` | §18.4 Z-score anomaly detection results — metric, device_id, detected_value, baseline_mean/stddev, z_score, severity ENUM(low/medium/high/critical), is_acknowledged |
| 302 | `churn_scores` | §18.4 Rule-based churn risk scores — score DECIMAL(5,2), risk_band ENUM(low/medium/high/critical), tenure_months, overdue_invoices, open_tickets, suspensions_30d, payments_late_90d, factors JSON |
| 303 | `resellers` | §19.1 Reseller hierarchy — self-referencing parent_id, level (1=master, 2=sub), commission_rate, white-label branding (logo, primary/accent color, portal_domain, portal_name), status ENUM(active/suspended/inactive); soft-delete |
| 304 | `reseller_plan_prices` | §19.1 Custom plan pricing per reseller — reseller_id+plan_id unique pair, custom_price overrides the base plan price, currency, is_active; upsert-safe |
| 305 | `reseller_commissions` | §19.1 Commission earnings per invoice — invoice_id FK, client_id FK, commission_rate snapshot, invoice_total, commission_amount, status ENUM(pending/approved/paid/cancelled), paid_at; INSERT IGNORE for idempotency |
| 306 | `reseller_ip_pool_allocations` | §19.2 IP pool access grants per reseller — FK to ip_pools (§5), INSERT IGNORE prevents duplicates, notes |
| 307 | `reseller_bandwidth_quotas` | §19.2 Per-reseller bandwidth cap — download/upload Mbps, burst limits, is_enforced flag; upsert-safe ON DUPLICATE KEY |
| 308 | `reseller_olt_port_assignments` | §19.2 OLT port grants per reseller — FK to olt_ports (§7), INSERT IGNORE, notes |
| 309 | `reseller_billing_entities` | §19.2 White-label billing entity per reseller — legal_name, tax_id, address, bank details (bank_name, bank_account, bank_clabe), invoice_prefix, invoice_footer, currency, is_active; upsert-safe |
| 310 | `integration_providers` | §20.2 Read-only catalog of 27 supported integration providers; seeded in migration 348; keyed by provider_key (UNIQUE) |
| 311 | `integration_connections` | §20.2 Per-org configured integration instances; credentials_enc (AES-256-GCM encrypted, never returned in API responses), config_json, status, last_synced_at |
| 312 | `integration_sync_logs` | §20.2 Sync execution records per connection — direction, status (queued/running/success/error/stubbed), records_in/out/error, error_message |
| 313 | `support_conversations` | §21.2 AI support conversation thread per customer/channel — channel ENUM (web/whatsapp/sms/email), status ENUM (open/escalated/closed), intent, confidence score, escalation_reason, ticket_id FK on escalation |
| 314 | `support_messages` | §21.2 Individual messages within a support conversation — role ENUM (customer/assistant/system), content TEXT, intent, confidence, data_sources JSON; FK to support_conversations CASCADE |
| 315 | `ai_diagnostic_runs` | §21.4 Recorded results from the AI diagnostic engine — symptom, access_type, checks JSON, cause, recommendation, auto_fix_available flag, confidence, escalate flag, escalation_reason; FK to support_conversations (SET NULL) |
| 316 | `kb_articles` | §21.8 Knowledge base articles for RAG support — title, body LONGTEXT, category, locale, tags, is_published flag, created_by FK; org-scoped with soft-delete |
| 317 | `kb_article_embeddings` | §21.8 Vector embeddings for semantic KB search — chunk_index, chunk_text TEXT, embedding_json LONGTEXT (serialized float array), embedded_at; FK to kb_articles CASCADE |
| 318 | `kb_feedback` | §21.8 User feedback on KB articles — feedback ENUM (helpful/not_helpful/inaccurate), notes, conversation_id FK (SET NULL); FK to kb_articles CASCADE |
| 319 | `support_channel_configs` | §21.6 Per-channel AI support configuration per organization — channel ENUM (web/whatsapp/sms/email), is_enabled flag, provider_id FK (SET NULL), escalation_threshold_confidence DECIMAL, max_turns, greeting_message; UNIQUE on (organization_id, channel) |
| 320 | `ai_support_metrics` | §21.10 Nightly KPI rollup for AI support — period_date, resolution_rate, fcr_rate (first-contact resolution), avg_handle_time_sec, escalation_rate, csat_avg, false_positive_rate, avg_latency_ms, total_conversations, total_escalations, total_ai_cost_usd; UNIQUE on (organization_id, period_date) |
| 321 | `noc_ai_insights` | §21.11 AI-generated NOC insights and alerts — insight_type ENUM (shift_summary/alert_explanation/capacity_warning/runbook_suggestion/interference_detection/alignment_drift), alert_id FK (SET NULL), device_id FK (SET NULL), affected_subscribers, summary TEXT, recommendation TEXT, confidence, provider_id FK (SET NULL); org-scoped |
| 322 | `organization_invoice_sequences` | Migration 381 Atomic per-organization invoice-number counter — `organization_id` is the PRIMARY KEY (sentinel `0` = the NULL/single-tenant bucket), `next_number` is advanced atomically by `billingService.nextInvoiceNumber()` to replace the collision-prone `COUNT(*)+1` invoice numbering |
| 323 | `organization_order_sequences` | Migration 384 Atomic per-organization service-order-number counter — `organization_id` is the PRIMARY KEY (sentinel `0` = the NULL/single-tenant bucket), `next_number` is advanced atomically by `lifecycleService.nextOrderNumber()` to replace the collision-prone `COUNT(*)+1` SO-###### numbering |

> **Migration 323–335 — Security & Access Control (§17):** webauthn_credentials, admin_ip_allowlist, password_policies, api_key_rate_limits, firewall_rules, ddos_protection_rules, blackhole_routes, dns_blocklists, cpe_security_scans, encryption_key_metadata, data_masking_rules, secure_deletion_log; plus 4 new roles (super_admin, noc_operator, reseller_admin, auditor) and 36 security module permissions.

> **Migration 336–343 — Automation & Scripting (§18):** automation_rules, automation_rule_executions, batch_jobs, batch_job_items, provisioning_pipelines, provisioning_pipeline_stages, remediation_rules, remediation_executions, automation_scripts, script_executions, router_driver_configs, device_command_executions, analytics_anomalies, churn_scores; plus 30 automation/analytics permissions and 3 scheduled tasks (anomaly_detection, churn_score_computation, remediation_evaluation). Script execution is STUB — no child_process dispatch; sandboxed executor required for live runs.

> **Migration 344–347 — Multi-Tenancy / Reseller Support (§19):** resellers (self-referencing hierarchy up to 2 levels deep, white-label branding, commission_rate), reseller_plan_prices (custom pricing overrides per reseller+plan), reseller_commissions (per-invoice earnings with approve/pay workflow), reseller_ip_pool_allocations, reseller_bandwidth_quotas, reseller_olt_port_assignments, reseller_billing_entities; plus `reseller_id` FK on clients table for reseller scoping. Includes 22 permissions across resellers, reseller_plan_prices, reseller_commissions, reseller_*_allocations/quotas/assignments, reseller_billing_entities, and reseller_portal modules, granted to admin, reseller_admin, and super_admin roles.

> **Migration 348–350 — APIs & Integrations (§20):** integration_providers (27-provider catalog seeded idempotently), integration_connections (per-org instances with AES-256-GCM encrypted credentials), integration_sync_logs (execution records). 8 permissions (integration_providers.view, integration_connections.view/create/update/delete/test/sync, integration_sync_logs.view) granted to admin and super_admin. Routes at /api/v1/integrations (10 endpoints). testConnection() and sync() are STUB — no live HTTP; credentials encrypted at rest and never returned in API responses.

> **Migration 351 — §21.2 AI Support:** Adds `support_conversations` and `support_messages` tables for multi-channel AI customer support conversations.

> **Migration 352 — §21.4 Diagnostics:** Adds `ai_diagnostic_runs` for recording diagnostic engine results.

> **Migration 353 — §21.8 Knowledge Base:** Adds `kb_articles`, `kb_article_embeddings`, and `kb_feedback` for the RAG knowledge base.

> **Migration 354 — §21.6/21.10:** Adds `support_channel_configs` and `ai_support_metrics` for channel configuration and nightly KPI rollup.

> **Migration 355 — §21.11 NOC AI:** Adds `noc_ai_insights` table for AI-generated Network Operations Center insights.

> **Migration 356 — §21 Permissions:** Seeds 14 support/NOC AI permissions and grants them to admin and super_admin roles.

> **Migration 357 — §21 Channel Defaults:** No-op; channel configs created lazily per org on first use.

> **Migration 358 — §21 Scheduled Task:** Seeds the `ai_support_metrics_rollup` task (nightly at 01:00, task_type=other).

> **Migration 369 — Org-level currency:** Adds `currency CHAR(3) NOT NULL DEFAULT 'MXN'` to `organizations` (AFTER country). Each org now has one authoritative ISO 4217 currency; plan create defaults to it when no currency is supplied; Inventory UI reads it dynamically.

> **Migration 371 — NAS access mode:** Adds `access_mode ENUM('direct','nated') NOT NULL DEFAULT 'direct'` to `nas`. In `direct` mode (default) the NAS has a routable IP and FireISP connects to it directly. In `nated` mode the device is behind NAT and FireISP reaches it exclusively over its WireGuard tunnel; `ip_address` is set to the allocated WG tunnel address at create time so RADIUS, health-checks, and the RouterOS API all use the tunnel uniformly.

> **Migration 165–173 table count note:** See migrations 241–246 below for the §5 Dual Stack tables. See migrations 249–263 for §6.1–6.6 SNMP & NMS tables.

> **Migration 241 — DHCP Server Integration (§5.1):** `241_create_dhcp_integration.sql` creates `dhcp_servers` (DHCP server registry supporting ISC Kea and MikroTik) and `dhcp_static_reservations` (MAC-to-IP bindings with DHCP Option 82 circuit/remote-id for subscriber identification). Foreign keys to `ip_pools`, `clients`, and `contracts` allow reservations to be linked to ISP provisioning data.

> **Migration 242 — NAT/CGNAT and PTR Records (§5.1):** `242_create_nat_ptr_management.sql` creates `nat_pools` (CGNAT/1:1 NAT/PAT pool definitions with external IP ranges and per-subscriber port limits) and `ptr_records` (reverse DNS PTR record management for both IPv4 and IPv6 with configurable TTL and zone).

> **Migration 243 — IPv6 Management Enhancements (§5.2):** `243_ipv6_management_enhancements.sql` adds 7 columns to `ip_pools` (DHCPv6 mode, Router Advertisement flags and lifetime, SLAAC prefix, region name) and `stack_type` to `plans` via stored-procedure guards. Creates `ra_guard_policies` table for per-port RA Guard policy management linked to devices.

> **Migration 244 — Dual-Stack Session Management (§5.3):** `244_dual_stack_session_management.sql` adds IPv6CP/DHCPv6-PD fields to `pppoe_service_profiles` (ipv6cp_enabled, delegated_prefix_len, DNS64), IPv6 RADIUS attributes to `radius` (Framed-IPv6-Address, Delegated-IPv6-Prefix, Framed-IPv6-Pool), and per-session IPv6 accounting fields to `connection_logs` (framed_ipv6_prefix, IPv6 octet counters, stack_type). All via stored-procedure guards; `connection_logs` uses no FK (partitioned table).

> **Migration 245 — IPv6 Transition Mechanisms (§5.4):** `245_create_transition_mechanisms.sql` creates four tables: `tunnel_6rd_configs` (6rd Border Relay + IPv6 prefix), `ds_lite_configs` (DS-Lite AFTR address), `map_rules` (MAP-E/MAP-T rule definitions with EA-bits), and `xlat464_configs` (464XLAT PLAT/CLAT/DNS64 prefixes). Together these support the four major IPv4-to-IPv6 transition mechanisms.

> **Migration 246 — Dual-Stack Permissions Seed (§5):** `246_seed_dual_stack_permissions.sql` seeds 25 permissions (`dhcp_servers.*`, `dhcp_reservations.*`, `nat_pools.*`, `ptr_records.*`, `ra_guard.*`, `transition_mechanisms.*`, `ipv6.management`) and assigns them to roles: admin (all 25), technician (all view permissions + ipv6.management), readonly (view permissions only).

> **Migrations 247–248 — Partition maintenance repair:** `247_repair_scheduled_tasks_seeds.sql` deduplicates and repairs ENUM-corrupted `scheduled_tasks` rows from prior seed migrations. `248_automate_partition_capacity_maintenance.sql` fixes `snmp_maintain_partitions()` and `connection_logs_maintain_partitions()` to start from the current month (not next month), and immediately materializes partitions for the current month through +3 months.

> **Migration 249 — Device Groups (§6.1):** `249_create_device_groups.sql` creates `device_groups` (org-scoped logical grouping by type/location/region/OLT/custom) and `device_group_members` junction table. Enables technicians to organize network devices for bulk operations and filtered monitoring views.

> **Migration 250 — SNMPv3 and Discovery (§6.1):** `250_snmpv3_and_discovery.sql` adds 8 SNMPv3 columns to `devices` (security name, auth/priv protocols, encrypted credentials, context name, last_polled_at, last_poll_error) via INFORMATION_SCHEMA-guarded procedures. Creates `discovery_scans` (CIDR-based network scan jobs with full SNMPv3 credential support) and `discovery_results` (per-host scan outcomes with auto-matched profile suggestions and onboarding status tracking).

> **Migration 251 — SNMP Trap Forwarding Rules (§6.1):** `251_snmp_trap_forwarding_rules.sql` creates `snmp_trap_forwarding_rules` with match criteria (trap_type, source_ip, OID prefix) and forwarding targets (HTTP URL, email, webhook ID). Extends the existing trap receiver for configurable routing.

> **Migration 252 — Vendor SNMP Profile Seeds (§6.2):** `252_seed_vendor_snmp_profiles.sql` seeds 8 new `snmp_profiles` with OID mappings: Cisco IOS (CISCO-PROCESS-MIB CPU, CISCO-MEMORY-POOL-MIB), Juniper JunOS (jnxOperatingCPU/Buffer), Huawei VRP (hwAvgDuty5min/hwEntityMemUsage), ZTE ZXAN (zxAnSysMgr CPU/memory), Generic Switch (IF-MIB + PoE RFC 3621), Generic UPS (RFC 1628 UPS-MIB), SFP Diagnostics (ENTITY-SENSOR-MIB Rx/Tx power), Environmental Sensors (ENTITY-SENSOR-MIB temperature/humidity). All ride the existing `snmp_metrics` rollup pipeline.

> **Migration 253 — SNMP Discovery Permissions (§6.1–6.3):** `253_seed_snmp_discovery_permissions.sql` seeds 12 permissions: `device_groups.*` (4), `discovery_scans.*` (4), `trap_forwarding.*` (4). Role matrix: admin (all 12), technician (5 operational permissions), readonly (3 view-only).

> **Migration 254 — Discovery Scheduled Tasks (§6.1):** `254_seed_discovery_scheduled_tasks.sql` seeds `snmp_discovery_poll` (every 5 min, snmp_poll type) and `snmp_trap_receiver` (one-shot, high priority) using the WHERE NOT EXISTS idempotency guard.

> **Migration 255 — Extended SNMP Metric Columns (§6.2):** `255_extend_snmp_metric_columns.sql` adds 12 new nullable metric columns to `snmp_metrics` (voltage_mv, temperature_c, fan_speed_rpm, if_in_discards, if_out_discards, sfp_tx_power_dbm, sfp_rx_power_dbm, sfp_temperature_c, ups_battery_pct, ups_runtime_min, poe_power_mw, humidity_pct) and 36 matching avg/min/max columns to `snmp_metrics_1hr` and `snmp_metrics_1day`. Rebuilds the rollup stored procedures to aggregate all new metrics.

> **Migration 256 — Device Monitoring OID Seeds (§6.2):** `256_seed_device_monitoring_oids.sql` seeds SNMP OID entries for extended device metrics: MikroTik board temperature/voltage/fan, SFP Diagnostics (Tx/Rx power, transceiver temp), Generic Switch (ifInDiscards, ifOutDiscards, PoE draw), Generic UPS (battery %, runtime), Environmental Sensors (humidity, ambient temp).

> **Migration 257 — SNMP Metrics Monitoring Permissions (§6.2/6.3):** `257_seed_snmp_monitoring_permissions.sql` seeds 3 new permissions: `snmp_metrics.view`, `snmp_metrics.top_talkers`, `snmp_metrics.interfaces`. Admin and technician receive all 3; readonly receives view-only.

> **Migration 258 — Polling Engine Tables (§6.4):** `258_polling_engine_tables.sql` creates `poller_nodes` (registry of dedicated SNMP poller nodes with heartbeat, queue depth, and performance stats), `device_polling_configs` (per-device or per-device-type polling interval overrides, SNMP GETBULK flags, adaptive polling thresholds, and failover node assignment), and `poller_performance_snapshots` (time-series poller health metrics). Seeds `snmp_adaptive_poll_check` (every 1 min, high priority) and `poller_performance_snapshot` (every 5 min, low priority) scheduled tasks. Adds `pollerEngine.js` service with `getPollingConfig` (4-level precedence lookup), `adaptivePollCheck` (in-memory Map for incidents), `recordPerformanceSnapshot`, and `getPerformanceDashboard`. New routes: `/poller-nodes` (CRUD + performance endpoint), `/device-polling-configs` (CRUD), `/poller-performance` (list + dashboard).

> **Migration 259 — Polling Engine Permissions (§6.4):** `259_seed_polling_engine_permissions.sql` seeds 9 permissions: `poller_nodes.*` (4), `polling_configs.*` (4), `poller_performance.view` (1). Admin gets all 9; technician gets 5 (views + polling_configs create/update + poller_performance.view); readonly gets 3 (views only).

> **Migration 260 — Alerting Enhancement Tables (§6.5):** `260_section65_alerting_tables.sql` creates 5 new tables: `alert_escalation_chains` + `alert_escalation_steps` (L1→L2→L3 escalation with per-step channel/delay config), `maintenance_windows` (alert suppression during planned work, supports recurring via cron), `alert_notification_channels` (multi-channel routing with AES-256-GCM encrypted credentials), `alert_suppression_rules` (upstream→downstream device correlation suppression). Extends `alert_rules` with 7 new columns (escalation_chain_id, flap detection config, baseline/dynamic threshold config) and `alert_events` with 5 new columns (escalation_step, escalated_at, flapping, suppressed, maintenance_window_id). Adds `alertService.evaluateAlertsV2` (maintenance window + correlation suppression + flap detection), `isInMaintenanceWindow`, `isSuppressedByCorrelation`, `checkFlapping`, `triggerEscalation`. Extends ALLOWED_METRICS/SNMP_METRICS with 12 hardware sensor metrics. New routes under `/alerts`: escalation-chains, maintenance-windows, notification-channels, suppression-rules, evaluate-v2.

> **Migration 261 — Alerting Permissions (§6.5):** `261_seed_alert_escalation_permissions.sql` seeds 16 permissions across 4 groups: `alert_escalations.*`, `maintenance_windows.*`, `alert_channels.*`, `alert_suppression.*`. Admin gets all 16; technician gets 8 (all views + maintenance_windows create/update + alert_channels.view); readonly gets 4 (views only).

> **Migration 262 — Config Management Tables (§6.6):** `262_create_config_management_tables.sql` creates 5 new tables: `config_templates` (named templates with {{variable}} placeholders), `config_deployment_records` (push tracking per device), `config_backup_schedules` (per-device/per-org backup schedules extending global nightly task), `config_compliance_rules` (must_contain/must_not_contain/regex_match/regex_not_match audit rules), `config_compliance_results` (audit outcomes per rule per backup). Extends `device_config_backups` with `diff_from_previous LONGTEXT` column. Adds `configBackupService.computeDiff`, `runComplianceAudit`, `pullBackupWithDiff`, `deployConfigTemplate`. New routes: `/config-templates` (CRUD + deploy endpoint), `/config-backup-schedules` (CRUD), `/config-compliance-rules` (CRUD + results + run endpoints). Extends `/device-config-backups` with diff, compliance-run, compliance-results endpoints.

> **Migration 263 — Config Management Permissions (§6.6):** `263_seed_config_management_permissions.sql` seeds 16 permissions: `config_templates.*` (4), `config_deployments.*` (3: view/create/update), `config_backup_schedules.*` (4), `config_compliance.*` (4 + special `config_compliance.run`). Admin gets all 16; technician gets 10 (all views + template create/update + schedule create/update + compliance.run); readonly gets 4 (views only).

> **Migration 264 — BNG/OLT/Switch OID Seeds + ifOperStatus (§6.2 gaps):** `264_seed_bng_olt_switch_oids.sql` adds `if_oper_status TINYINT` (1=up/2=down/3=testing/7=lowerLayerDown) to `snmp_metrics` and matching avg/min/max columns to `snmp_metrics_1hr` and `snmp_metrics_1day` via a guarded stored procedure. Seeds four new `snmp_profiles`: Cisco BNG (ASR1000/ASR9000: CISCO-PROCESS-MIB cpmCPUTotal5minRev, CISCO-MEMORY-POOL-MIB, CISCO-SUBSCRIBER-SESSION-MIB, IF-MIB 64-bit), Juniper BNG (MX-series: jnxOperatingCPU/Buffer, jnxSubscriberActiveCount, IF-MIB), Huawei OLT (MA5800/EA5800: hwEntityCPU/Mem/Temperature, XPON Rx power, ONU counts, IF-MIB), ZTE OLT (C300/C320: zxAnSysMgr CPU/Mem, GPON ONU counts, Tx power, IF-MIB). Extends Generic Switch profile with ifHCInOctets/Out (64-bit), ifOperStatus, ifIn/OutDiscards, pethPsePortDetectionStatus (RFC 3621). `snmpPoller.js` VALID_METRIC_COLUMNS and `insertMetricRow` updated for `if_oper_status`. `snmpMetrics.js` interfaces endpoint now returns `avg_if_oper_status/min_if_oper_status`. `SnmpMetrics.tsx` adds `SwitchPortsPanel` — port status table per device interface showing up/down badge, throughput avg, errors, discards, PoE/SFP power.

> **Migration 265 — Graph Retention: Hourly 7d, Daily 90d, Monthly 3yr (§6.3):** `265_graph_retention_monthly_rollup.sql` creates `snmp_metrics_1month` (monthly aggregates, wide-table with all columns from mig-255+264, retained 3 years). Seeds `snmp_rollup_state.1month` high-watermark row. Recreates `snmp_apply_retention()` with corrected thresholds: 1hr→7 days (was 1 year), 1day→90 days (was indefinite), 1month→3 years. Creates `snmp_rollup_to_1month()` high-watermark procedure (aggregates `snmp_metrics_1day` into monthly rows via ON DUPLICATE KEY UPDATE). Adds `evt_snmp_rollup_1month` (daily 01:00) and recreates `evt_snmp_retention` (daily 02:00). All retention uses batch-DELETE LIMIT 10000 loops (tables are not partitioned).

> **Migration 279 — Wireless/WISP Sector & AP Management Tables (§9.1):** `279_wireless_ap_sector_tables.sql` creates five tables: `ap_channel_plans` (channel assignment registry per site — frequency_mhz, channel_width_mhz, status), `ap_sector_configs` (AP/PTP wireless RF configuration — azimuth, width, frequency, channel_width, tx_power, encryption ENUM, channel_plan FK, antenna_gain_dbi, height_m, polarization, max_clients), `wireless_client_sessions` (append-only CPE state snapshots per AP poll — MAC, IP, signal/noise/SNR/CCQ/rates/distance, last_seen_at), `ap_command_jobs` (remote command queue for set_tx_power/set_frequency/set_channel_width/reboot/other with status lifecycle and scheduled execution), `wireless_channel_interference` (detected RF interference records with interference_level ENUM and conflicting_ap_mac). Also adds 7 RF metric columns to `snmp_metrics` (noise_floor_dbm, air_util_pct, gps_sync_status, snr_db, ccq_pct, tx_rate_mbps, rx_rate_mbps) and 21 matching avg/min/max columns to `snmp_metrics_1hr`, `snmp_metrics_1day`, `snmp_metrics_1month` via a single guarded stored procedure. `snmpPoller.js` VALID_METRIC_COLUMNS updated with all 7 RF columns.

> **Migration 280 — Wireless Vendor SNMP Profile and OID Seeds (§9.1):** `280_wireless_vendor_oid_seeds.sql` seeds four new `snmp_profiles`: Mimosa Networks (A/B/C-series, MIB prefix 1.3.6.1.4.1.43356 — signal, noise floor, CCQ, air util, DL/UL rates), Tarana Wireless (G1 PTMP, prefix 1.3.6.1.4.1.50536 — RSSI, noise, SNR, GPS sync, airtime util, DL/UL capacity), Radwin (2000/5000 series, prefix 1.3.6.1.4.1.4329 — RSL, noise floor, SNR, airtime util), Siklu (E-band mmWave, prefix 1.3.6.1.4.1.31926 — RSL, SNR, Tx/Rx capacity). Also extends existing Ubiquiti airOS profile with 6 new RF OIDs (ubntAirIfNoiseFloor .4.5.1.4, ubntAirIfCcq .4.5.1.11, ubntAirIfAirmaxCapTx .4.5.1.7, ubntAirIfSnr .4.5.1.6, Tx/Rx rate .4.5.1.19/.20) and MikroTik RouterOS with 4 RF OIDs (noise proxy .2.1.13, Tx CCQ .3.1.9, Tx/Rx rate .2.1.8/.9).

> **Migration 281 — Wireless RBAC Permissions Seed (§9.1):** `281_seed_wireless_permissions.sql` seeds 15 permissions in the `wireless` module: `ap_sectors.*` (4), `ap_channel_plans.*` (4), `wireless_clients.view` (1), `wireless_channels.*` (2: view/manage), `ap_commands.*` (2: view/create), `wireless_speed_profiles.*` (2: view/manage). Role matrix: admin (all 15), technician (all view + create/update for ap_sectors/channel_plans/ap_commands), readonly (5 view permissions). New REST routes under `/api/v1/wireless`: `/ap-sectors` (CRUD + restore), `/channel-plans` (CRUD + restore + conflicts/:siteId), `/clients` (list + batch ingest), `/channel-interference` (CRUD), `/ap-commands` (CRUD + cancel).

> **Migration 286 — QoS Speed Profiles (§10.1):** `286_qos_speed_profiles.sql` creates `quality_classes` (priority class registry — traffic_type ENUM voip/video/web/download/other, priority 1–8, DSCP mark, MikroTik queue kind, max_limit_pct; seeds 4 default global classes: VoIP/EF/p1, Video/AF41/p2, Web/CS3/p4, Bulk/BE/p8) and `queue_tree_nodes` (hierarchical queue tree — parent_id self-FK for tree structure, queue_type ENUM tree/simple, interface, max/burst/threshold limits, burst_time_seconds, queue_kind, sort_order). Adds 3 guarded columns to `plans` via stored-procedure guards: `burst_threshold_mbps` and `burst_time_seconds` (MikroTik burst semantics — burst is active when 8 s average rate is below threshold, defaults to CIR/8s if omitted), `priority_class_id` FK→quality_classes. `radiusAttributeService.generateAttributes()` updated to emit the full 4-field MikroTik rate-limit string (`CIR/CIR burst/burst threshold/threshold burst-time`). New `qosService.js` with `buildRateString()` (per-vendor rate string builder) and `exportQueueTreeConfig()` (generates MikroTik RouterOS `/queue tree` + `/queue simple` script — stub driver pattern matching §7/§9; push to NAS via SSH/API outside FireISP scope). New routes: `/quality-classes` (CRUD + restore), `/queue-tree-nodes` (CRUD + restore + `GET /export/config?format=text` for `.rsc` download). Plan.js fillable updated with new fields; plan schemas expose burst_threshold_mbps, burst_time_seconds, priority_class_id.

> **Migration 287 — QoS Permissions Seed (§10.1):** `287_seed_qos_permissions.sql` seeds 9 permissions in the `qos` module: `quality_classes.*` (4), `queue_tree_nodes.*` (4), `queue_tree_nodes.export` (1). Role matrix: admin (all 9), technician (views + queue_tree_nodes.export), readonly (views only).

> **Migration 288 — Rate Limiting Tables (§10.2):** `288_rate_limiting_tables.sql` creates `rate_limit_templates` (named templates per service type — service_type ENUM pppoe/dhcp/hotspot/static/other, radius_vendor ENUM mikrotik/cisco/juniper/generic, CIR + burst + threshold speeds, cached rate_string rendered on save) and `protocol_shaping_rules` (per-protocol/port shaping rules — protocol/direction/port-range/L7-pattern match, action ENUM limit/drop/mark/throttle, optional rate limits and DSCP mark, enabled flag, preset name). Seeds 3 disabled global preset rules: BitTorrent Throttle (TCP 6881–6889, throttle to 5M/2M), VoIP Priority (UDP 16384–32767, DSCP EF mark), HTTP/HTTPS Priority (TCP 80,443, DSCP AF21 mark). New `qosService.exportShapingRulesConfig()` generates MikroTik mangle rules script (stub — actual NAS push requires SSH/API). New routes: `/rate-limit-templates` (CRUD + restore + `POST /preview`), `/protocol-shaping-rules` (CRUD + restore + `GET /export/config`). Rate string auto-rendered on create/update.

> **Migration 289 — Rate Limiting Permissions Seed (§10.2):** `289_seed_rate_limiting_permissions.sql` seeds 8 permissions in the `qos` module: `rate_limit_templates.*` (4), `protocol_shaping_rules.*` (4). Role matrix: admin (all 8), technician (views + create/update for both), readonly (views only).

> **Migration 290 — FUP Data Rollover and Data Packs (§10.3):** `290_fup_data_rollover_and_packs.sql` creates 4 tables: `data_rollover_balances` (monthly carry-forward ledger, UNIQUE on contract_id+billing_month), `data_packs` (add-on data packages), `data_pack_purchases` (subscriber purchase records, RESTRICT FK to data_packs), `fup_usage_notifications` (80/90/100% threshold alert log, UNIQUE on contract_id+billing_month+threshold_pct). Seeds 2 scheduled tasks: `fup_threshold_notify` (notification type, every 15 min) and `rollover_balance_accrue` (usage_rollup type, 1st of month).

> **Migration 291 — FUP and Data Pack Permissions Seed (§10.3):** `291_seed_fup_data_pack_permissions.sql` seeds 8 permissions in the `fup` module: `data_packs.*` (4), `data_pack_purchases.view/create` (2), `data_rollover.view/manage` (2). Role matrix: admin (all 8), technician (6: all except data_packs.delete and data_rollover.manage), readonly (3 view permissions).

> **Migration 292 — Traffic Engineering Tables (§10.4):** `292_traffic_engineering_tables.sql` extends `queue_tree_nodes.queue_type` ENUM to add cbq/hfsc/pcq values (via stored-procedure guard) and adds `vendor_platform` ENUM column. Creates 3 tables: `interface_qos_policies` (per-interface HTB/CBQ/HFSC/PCQ policies with parent_policy_id self-FK), `mpls_vlan_prioritization_rules` (MPLS label and 802.1p/q VLAN priority mapping), `dscp_marking_policies` (DSCP marking/remarking rules). Seeds 4 default DSCP policies: EF/46 (VoIP), AF41/34 (Video), CS3/24 (Signaling), BE/0 (Best Effort).

> **Migration 293 — Bandwidth Test Servers (§10.4):** `293_bandwidth_test_servers.sql` creates `bandwidth_test_servers` (iperf3/speedtest endpoint registry, FK to sites SET NULL) and `subscriber_speed_test_jobs` (test job queue, FK to bandwidth_test_servers SET NULL, contracts CASCADE). Seeds `subscriber_speed_test_run` scheduled task (task_type=other, every 5 min, priority=low).

> **Migration 294 — Traffic Engineering Permissions Seed (§10.4):** `294_seed_traffic_engineering_permissions.sql` seeds 19 permissions in the `qos` module: `interface_qos_policies.*` (4), `mpls_vlan_prioritization.*` (4), `dscp_marking_policies.*` (4), `bandwidth_test_servers.*` (4), `subscriber_speed_tests.view/create/update` (3). Role matrix: admin (all 19), technician (15: all except 4 delete permissions), readonly (5 view permissions).

> **Migration 295 — Customer Self-Service Portal Tables (§11):** `295_portal_self_service_tables.sql` creates 4 tables: `portal_service_requests` (self-service request workflow — plan_upgrade/wifi_password_change/pppoe_password_change/static_ip_request/cancellation/visit_schedule; status lifecycle pending→approved/rejected→completed; proration fields for plan upgrades; payload JSON for type-specific parameters), `portal_kb_articles` (knowledge-base / FAQ articles with org-scoped slug UNIQUE key, view/rating counters, is_published flag), `portal_chat_sessions` (AI chatbot sessions — session_token UNIQUE, messages JSON array, status escalated triggers ticket creation, turn_count), `portal_push_subscriptions` (Web Push browser notification subscriptions — endpoint, p256dh, auth keys, per-event-type notification flags).

> **Migration 296 — Customer Self-Service Portal RBAC Permissions Seed (§11):** `296_seed_portal_self_service_permissions.sql` seeds 7 permissions in the `portal` module: `portal_kb.view/create/update/delete` (4 — admin-side KB management), `portal_service_requests.view/update` (2 — admin review and approval of client requests), `portal_push.view` (1 — Web Push subscription visibility; dispatch is event-bus-driven). Role matrix: admin (all 7), technician (6: KB view/create/update, service_requests view/update, push view), readonly (3 view permissions).

> **Migration 297 — Ticketing Extensions and Work Order Tables (§12):** `297_ticketing_noc_tables.sql` adds `source ENUM('manual','alert','portal','ai_escalated')` column to `tickets` via INFORMATION_SCHEMA-guarded stored procedure. Creates 6 new tables: `ticket_time_logs` (per-ticket time tracking — user_id FK, minutes, work_date, description), `ticket_relations` (typed ticket relationships — duplicate/related/blocks/blocked_by; UNIQUE on pair + relation_type), `ticket_ai_triage` (AI triage results per ticket — suggested_category/priority/resolution, kb_article_ids JSON, context_snapshot JSON; UNIQUE on ticket_id), `work_orders` (field work orders — org-scoped, optional ticket FK SET NULL, assigned_to technician, GPS coordinates, soft-delete), `work_order_materials` (material usage log per work order — item_name, quantity DECIMAL, unit, unit_cost), `technician_gps_breadcrumbs` (append-only GPS log — no FKs for write performance, composite index on user_id + recorded_at DESC).

> **Migration 298 — NOC, Work Order, and Ticket Extension Permissions Seed (§12):** `298_seed_noc_permissions.sql` seeds 14 permissions across 3 modules: `noc` module (`noc.view`, `work_orders.*` (5), `work_order_materials.*` (3), `technician_tracking.*` (2)), `tickets` module (`ticket_relations.*` (2), `ticket_time_logs.*` (2)). Role matrix: admin (all 14), support (11: all except work_orders.delete, work_order_materials.delete, tracking.ingest), technician (8: work_orders view/update, materials view/create, tracking view/ingest, time_logs view/manage), readonly (6: view-only).

> **Migration 299 — SLA Breach Check Scheduled Task Seed (§12):** `299_seed_sla_breach_check_task.sql` seeds `sla_breach_check` scheduled task (task_type=notification, `*/5 * * * *`) to detect and escalate open tickets approaching or past their SLA deadline. Uses `WHERE NOT EXISTS` guard.

> **Migration 300 — Ticket Attachments (§12):** `300_create_ticket_attachments.sql` creates `ticket_attachments` table (FK to tickets CASCADE) and seeds 3 permissions (view/create/delete) assigned to admin/support/technician/readonly.

> **Migration 301 — Work Order Attachments (§12):** `301_create_workorder_attachments.sql` creates `work_order_attachments` table (FK to work_orders CASCADE) and seeds 3 permissions assigned to admin/support/technician/readonly.



> **Migration 302 — Topology and Mapping Tables (§13):** `302_topology_mapping_tables.sql` adds `latitude`, `longitude`, and `parent_device_id` columns to `devices` via INFORMATION_SCHEMA guards, and creates: `map_geofences` (polygon/radius zones), `map_infrastructure_points` (tower/cabinet/ODF pins), `fiber_route_segments` (fiber polyline segments), `device_dependency_edges` (directed dependency graph for impact analysis).

> **Migration 303 — Topology and Mapping Permissions (§13):** `303_seed_topology_permissions.sql` seeds 12 permissions across topology, mapping, and geofences modules. Admin gets all 12; technician gets 8; support gets 4; readonly gets 2.

> **Migration 304 — Geofence Evaluation Task (§13.2):** `304_seed_geofence_evaluation_task.sql` seeds `geofence_evaluation` scheduled task (task_type=other, `*/10 * * * *`) running `geoFenceService.evaluateAll()` per org.

> **Migration 305 — Inventory & Asset Management Tables (§14):** `305_inventory_asset_management_tables.sql` creates six new tables: `vendors` (supplier registry with contact info, payment terms, currency, soft-delete), `purchase_orders` (PO lifecycle draft→sent→partial→received/cancelled with warehouse destination and line-item totals), `purchase_order_items` (line items with GENERATED STORED total_cost), `assets` (individually tracked physical assets with serial numbers, barcodes, warranty expiry, depreciation, and disposal tracking — linked to vendors, warehouses, and purchase orders), `asset_assignments` (equipment assignment history for customer and device/port targets), and `rma_requests` (RMA workflow with replacement asset tracking).

> **Migration 306 — Inventory & Asset Permissions Seed (§14):** `306_seed_inventory_asset_permissions.sql` seeds 20 permissions across four modules: `vendors.*` (4), `purchase_orders.*` (5 including purchase_orders.receive), `assets.*` (7 including assets.assign/dispose/scan), `rma.*` (4 including rma.close). Role matrix: admin (all 20), technician (8 operational permissions), readonly (4 view-only permissions).

> **Migration 307 — Low-Stock Scheduled Task (§14.1):** `307_seed_inventory_low_stock_task.sql` seeds `inventory_low_stock_check` (task_type=notification, cron `0 * * * *` — every hour) to scan inventory items below their reorder level and dispatch low-stock alert notifications.

> **Migration 308 — Reporting & Analytics Tables (§15):** `308_reporting_analytics_tables.sql` creates three tables: `report_definitions` (template registry with report_type ENUM, parameters JSON schema, output_formats JSON, soft-delete), `scheduled_reports` (delivery schedule with cron_expression, recipients JSON array, last/next run tracking, soft-delete), and `generated_reports` (immutable generation history with file_path, status, generation_time_ms; nullable FK to scheduled_reports).

> **Migration 309 — Dashboard Widgets Table (§15.5):** `309_dashboard_widgets_table.sql` creates `dashboard_widgets` (per-user analytics widget layout: widget_type ENUM with 8 types, position_x/y and width/height grid coordinates, config JSON, is_visible flag; scoped to user + organization).

> **Migration 310 — Custom Reports Table (§15.5):** `310_custom_reports_table.sql` creates `custom_reports` (user-authored report definitions: query_type ENUM sql/visual, sql_query TEXT — validated SELECT-only at API level, visual_config JSON, is_public flag, last_run_at; scoped per organization with soft-delete).

> **Migration 311 — Reporting Permissions Seed (§15):** `311_seed_reporting_permissions.sql` seeds 11 RBAC permissions: `reports.view/generate/schedule/export/manage_definitions`, `dashboard_widgets.view/manage`, `custom_reports.view/create/execute/manage`. Role matrix: admin (all 11), billing (8 — all except custom_reports.execute/manage), technician (reports.view + dashboard_widgets.view), support (reports.view + dashboard_widgets.view), readonly (reports.view + dashboard_widgets.view + custom_reports.view).

> **Migration 312 — Scheduled Reports Task (§15.5):** `312_seed_scheduled_reports_task.sql` seeds `generate_scheduled_reports` (task_type=other, cron `0 * * * *` — hourly) dispatched by `scheduledReportService.processScheduledReports()`. Finds enabled schedules where next_run_at <= NOW(), generates report data via `reportService`, formats as CSV/XLSX/PDF, inserts a `generated_reports` history row, emails recipients via `emailTransport`, and advances next_run_at.

> **Migration 313 — Report Definitions Seed (§15 fix):** `313_seed_report_definitions.sql` populates `report_definitions` with 34 built-in report rows (organization_id=NULL, is_system=1) covering all slugs dispatched by `scheduledReportService.generateReportData()`: financial (aging, financial, revenue-by-period/plan/region/agent, cash-flow, payment-methods, churn-revenue, agent-commissions, tax-summary, sat-export), operational (technicians, subscriber-growth, subscriber-counts, arpu, uptime-by-area, mttr, installation-completion), network (bandwidth-utilization, top-consumers, congested-links, sfp-lifespan, optical-degradation, device-reboots, snmp-poll-success, alert-frequency, capacity-forecast, pon-utilization), and compliance (data-retention-compliance, ip-assignment-log, subscriber-identity, interception-readiness, regulatory-export). Activates the previously orphaned `reports.generate` and `reports.manage_definitions` permissions: `POST /reports/generate` runs a report on-demand (records in generated_reports); `POST /scheduled-reports/:id/run` manually triggers a schedule; `GET|POST /report-definitions` and `GET|PUT|DELETE /report-definitions/:id` provide CRUD for the registry.

> **Migration 314-322 — Regulatory Compliance (Mexico):** subscriber_consents, dsar_requests, identity_verification_records, gov_data_requests, phone_number_inventory, number_portability_records, numbering_blocks, uso_obligations, rural_coverage_reports, service_modification_notices, data_residency_config, report_access_logs; §16.2-16.9 regulatory compliance workflow.

> **Migrations 237–240 — §4 PPPoE Management Phase B (Service Profiles, Diagnostics, Permissions):**
> `237_create_pppoe_service_profiles.sql` creates `pppoe_service_profiles` table and adds guarded `service_profile_id` columns to `ip_pools` and `radius` (both FK→pppoe_service_profiles ON DELETE SET NULL). `238_create_radpostauth.sql` adds `radpostauth` table (no FKs — FreeRADIUS writes directly). `239_create_pppoe_event_logs.sql` adds `pppoe_event_logs` table (no FKs on organization_id/nas_id for loose-coupling syslog ingest). `240_seed_pppoe_phase_b_permissions.sql` seeds 6 RBAC permissions (`pppoe_service_profiles.view/create/update/delete`, `pppoe.diagnostics`, `pppoe.events_ingest`) and registers the `scan_auth_failures` scheduled task (every 15 min). New services: `pppoeDiagnosticsService` with `classifyAuthFailures()` (org-scoped radpostauth query, reason classification: bad_password/unknown_user/session_limit/no_pool/other), `detectMtuIssues()` (profile MTU > 1492 advisory + heuristic LCP-failure/MTU-mismatch advisory), `scanAuthFailures()` (scheduler handler, emits `pppoe.auth_failures` events). `syncFreeradiusTables()` extended: loads active service profiles per org, determines effective profile per subscriber (account-level `service_profile_id` overrides pool-level), emits `Framed-MTU`, `MS-Primary-DNS-Server`, `MS-Secondary-DNS-Server`, `Session-Timeout`, `Idle-Timeout`, `Filter-Id`, `Mikrotik-Address-List`, and `Mikrotik-Rate-Limit` radreply rows. RouterOS log line parser `parseRouterOsLogLine()` handles PADI/PADS/LCP/IPCP/AUTH/PADT patterns. New API endpoints: full CRUD under `/pppoe-service-profiles` + restore; `GET /pppoe/diagnostics/auth-failures`, `GET /pppoe/diagnostics/mtu-issues`, `GET /pppoe/events` (JWT auth); `POST /pppoe/events` (M2M secret auth via `X-Pppoe-Secret` header or `Authorization: Bearer`). Env vars: `PPPOE_EVENTS_SECRET` (M2M secret, falls back to `RADIUS_ACCOUNTING_SECRET`).

> **Migrations 235–236 — §4.1 PPPoE Management Phase A (Pool Enhancements, Permissions):**
> `235_ip_pools_pppoe_enhancements.sql` adds five guarded columns to `ip_pools`: `nas_id` (FK→nas, for NAS-pool binding), `service_type` ENUM, `default_prefix_len` (IPv6 PD), `excluded_ranges` TEXT, and `last_alerted_threshold` TINYINT (utilization crossing tracker). `236_seed_pppoe_management_permissions.sql` seeds five RBAC permissions (`ip_pools.assign`, `ip_pools.utilization`, `ip_pools.binding_report`, `connection_logs.summary`, `radius.batch_disconnect`) with role assignments, and registers the `check_pool_utilization` hourly scheduled task.

> **Migrations 230–234 — §3.3+§3.4 RADIUS/AAA Phase C (Accounting, CoA hardening, NAS health):**
> `230_radius_accounting_ingest_columns.sql` adds 6 columns to `connection_logs` via stored-procedure guards (partitioned table): `acct_session_id` (Acct-Session-Id), `nas_port_id`, `called_station_id`, `calling_station_id`, `framed_ip`, `framed_ipv6_prefix`; adds index on `acct_session_id`. `231_create_mac_move_events.sql` adds `mac_move_events` table (no FK constraints — loose refs for compliance). `232_nas_registry_enhancements.sql` adds `coa_port`, `location`, `site_id` (FK→sites SET NULL), `secondary_nas_id` (self-ref FK SET NULL), `health_status`, `last_health_check_at` to `nas`. `233_radius_accounting_retention_setting.sql` seeds `purge_radius_accounting` (daily 03:00) and `nas_health_check` (*/5 * * * *) scheduled tasks. `234_seed_radius_accounting_permissions.sql` seeds `radius.accounting_ingest`, `radius.cdr_export`, `radius.coa`, `radius.mac_move_events.view`, `nas.health` RBAC permissions.
> New services: `radiusAccountingService` (ingest Start/Stop/Interim-Update into connection_logs with Gigawords wraparound handling, MAC move detection + synthesised stop rows, CDR export JSON/CSV, retention purge); `radiusCoaEncoder` (RFC 2865 byte-level encoding for User-Name, Framed-IP-Address, VSA type 26 — MikroTik vendor 14988 attrs 8+19, Cisco vendor 9 attr 1); `nasHealthService` (RADIUS Status-Server code 12 probes with Message-Authenticator, up/down transition events). `suspensionService.sendRadiusPacket` upgraded: extra attributes via `encodeNamedAttributes`, secondary NAS failover when primary `sent=false`. New endpoints: `POST /radius/accounting` (machine-to-machine, `RADIUS_ACCOUNTING_SECRET` header auth); `GET /radius/cdr` (audit-logged CDR export with `?from=&to=&username=&format=csv|json`); `POST /radius/coa` (dynamic per-subscriber CoA with named attributes); `GET /radius/mac-move-events` (paginated MAC move log); `GET/POST /nas/:id/health[-check]`. Frontend: new `/mac-move-events` page; `NasList` updated with health badge, CoA port, location, failover NAS fields. Env vars: `RADIUS_ACCOUNTING_SECRET` (required for ingest), `RADIUS_ACCOUNTING_ORG_ID` (single-org deployments), `RADIUS_ACCOUNTING_RETENTION_MONTHS` (default 12). FreeRADIUS rest module configuration documented in `docs/freeradius/README.md`.

> **Migrations 225–229 — §3.2 RADIUS/AAA Phase B (Authorization Gaps):**
> `225_radius_authorization_plan_columns.sql` adds `session_timeout_seconds`, `idle_timeout_seconds`, `simultaneous_use` (default 1) to `plans`, and `simultaneous_use` (NULL=inherit plan), `vlan_id`, `inner_vlan_id` to `radius`; seeds `kick_duplicate_sessions` scheduled task (every 5 min). `226_create_plan_access_windows.sql` adds the `plan_access_windows` table (day_mask + time window, mirroring `plan_speed_windows`). `227_walled_garden_and_suspension_action.sql` adds `organization_walled_garden_settings` and extends `suspension_rules.action` ENUM with `walled_garden`. `228_create_radius_account_routes.sql` adds `radius_account_routes` for per-account `Framed-Route` injection. `229_seed_radius_authz_permissions.sql` seeds RBAC permissions for `plan_access_windows.*`, `radius_account_routes.*`, `walled_garden.*`, `radius.kick_sessions`. Sync now emits: `Session-Timeout` / `Idle-Timeout` in radgroupreply; `Login-Time` in radgroupcheck from access windows (serialized by `radiusLoginTimeService`); `Simultaneous-Use :=` in radcheck (account override wins); `Tunnel-Type`, `Tunnel-Medium-Type`, `Tunnel-Private-Group-Id` in radreply for VLAN assignment (plus `:1` tag for QinQ); `Mikrotik-Address-List` in radreply for walled subscribers; `Framed-Route +=` per route row. New `walledGardenSuspendContract()` / `walledGardenReconnect()` functions handle CoA + suspension log + immediate re-sync. New `kickDuplicateSessions()` finds over-limit subscribers and disconnects oldest sessions via existing Disconnect-Request path. New API endpoints: `GET/POST /plans/:id/access-windows`, `PUT/DELETE /plans/:id/access-windows/:windowId`; `GET/POST /radius/:id/routes`, `PUT/DELETE /radius/:id/routes/:routeId`; `GET/PUT /radius/walled-garden`; `POST /radius/kick-sessions`. Walled garden NAS-side setup documented in `docs/freeradius/README.md`.

> **Migrations 223–224 — §3.1 RADIUS/AAA Phase A:**
> `223_create_freeradius_standard_tables.sql` adds the five standard FreeRADIUS SQL tables (`radcheck`, `radreply`, `radusergroup`, `radgroupcheck`, `radgroupreply`) required by FreeRADIUS `rlm_sql`; adds `auth_method ENUM('pppoe','mac','dot1x','eap_tls')` to the `radius` table (stored-procedure guard); creates the `subscriber_certificates` table for EAP-TLS certificate metadata; and seeds the `check_certificate_expiry` scheduled task (daily 06:00). `radiusService.syncFreeradiusTables()` materializes these tables from FireISP state — radcheck rows are auth-method-aware (Cleartext-Password for PPPoE/dot1x/EAP-TLS, Auth-Type or MAC-as-password for MAB, TLS-Cert-Serial for EAP-TLS), radgroupreply rows carry vendor speed attributes from `radiusAttributeService`. MAB password mode is configurable via org setting `mab_password_mode`. `224_seed_radius_aaa_permissions.sql` seeds `subscriber_certificates.*` and `radius.sync` RBAC permissions. New endpoints: `POST /radius/sync-freeradius`, full CRUD under `/subscriber-certificates` plus `POST /subscriber-certificates/:id/revoke`, `GET /subscriber-certificates/radius-account/:id`, `GET /subscriber-certificates/client/:id`. FreeRADIUS setup guide in `docs/freeradius/`.

> **Migrations 217–222 — §2.5 (Refund Requests, Disputes, Chargebacks, Billing Adjustments):**
> Adds `refund_requests` table (217) with status lifecycle `requested → under_review → approved/rejected → processed`; RBAC seeds (218); `billing_disputes` + `dispute_evidence` tables (219) with multipart evidence upload reusing the existing upload middleware; dispute RBAC seeds (220); `chargebacks` + `billing_adjustments` tables (221); chargeback/adjustment RBAC seeds (222). `paymentGatewayService.handleWebhookEvent` now auto-creates a chargeback row when a dispute webhook is received. `billingAdjustmentService.record()` is called from refund processing and mirrors each adjustment into `audit_logs`. New events: `refund.requested` (webhook dispatch to billing staff), `refund.processed` (email to client + webhook).

> **Migrations 211–216 — §2.3+§2.4 (Payment Plans, Cash Reconciliation, Soft Suspension, Suspension Exempt):**
> Adds payment plan / installment management (211–212), cash reconciliation sessions (213–214), soft-suspend ENUM + speed columns on suspension_rules (215), and suspension_exempt columns on clients (216).

> **Migrations 204–210 — Billing & Subscription Management Phase B (§2.2B):** `204_create_organization_invoice_settings.sql` adds the `organization_invoice_settings` table for per-org invoice branding (logo URL, header color, footer legal text, payment instructions); `pdfService.generateInvoicePdf` now reads these settings. `205_seed_invoice_settings_permissions.sql` seeds `invoice_settings.view` and `invoice_settings.update`. `206_create_late_fee_tables.sql` adds `late_fee_rules` and `invoice_late_fees` tables and seeds the `apply_late_fees` scheduled task (daily 02:00). `207_seed_late_fee_permissions.sql` seeds `late_fees.view` and `late_fees.manage`. `208_create_payment_reminder_tables.sql` adds `payment_reminder_settings` and `payment_reminder_logs` tables and seeds the `send_payment_reminders` scheduled task (hourly). `209_seed_payment_reminder_permissions.sql` seeds `payment_reminders.view` and `payment_reminders.manage`. `210_seed_tax_report_permissions.sql` seeds `billing.tax_reports`. New endpoints: `GET/PUT /invoice-settings`, `GET/POST/PUT/DELETE /late-fee-rules`, `GET/PUT /payment-reminder-settings`, `GET /billing/tax-reports`, `GET /invoices/:id/receipt`, `GET /payments/:id/receipt`.

> **Migrations 200–203 — Plan billing features (§2.1):** `200_plan_billing_features.sql` adds ten columns to `plans` (`radius_vendor`, `radius_rate_limit_template`, `fup_threshold_gb`, `fup_threshold_percent`, `fup_download_speed_mbps`, `fup_upload_speed_mbps`, `overage_mode`, `overage_price_per_gb`, `trial_days`, `trial_price`) and creates `plan_throttle_logs` for FUP throttle audit; seeds `check_fup_thresholds` (every 15 min) and `convert_expired_trials` (hourly) scheduled tasks. `201_create_plan_speed_windows.sql` adds the `plan_speed_windows` table for time-based speed scheduling and seeds the `apply_speed_windows` task (every 5 min). `202_extend_plan_addons_enum.sql` extends `plan_addons.addon_type` with `voip` and `iptv` values. `203_seed_plan_feature_permissions.sql` seeds `plans.radius_attributes`, `plans.speed_windows`, and `plans.fup_throttle` RBAC permissions with role assignments.

> **Migrations 198–199 — Communication campaigns and DND (§1.4):** `198_create_communication_tables.sql` adds the `communication_campaigns`, `campaign_messages`, and `client_dnd_preferences` tables; adds `campaign_message_id` and `opened_at` columns to `email_logs`; adds `campaign_message_id` to `sms_logs`; and seeds the `campaign_send` scheduled task (`*/5 * * * *`) that processes queued campaign messages. `199_seed_communication_permissions.sql` seeds the `communication` RBAC module permissions (`campaigns.*`, `dnd.view`, `dnd.update`) and assigns them to the default roles.

> **Migrations 196–197 — Interaction tracking (§1.3):** `196_create_interaction_tracking_tables.sql` adds the `client_interactions`, `follow_up_reminders`, `satisfaction_surveys`, and `ticket_escalations` tables and seeds three scheduled tasks: `follow_up_reminders` (notify assignees of due follow-ups, every 15 min), `dispatch_satisfaction_surveys` (auto-send CSAT surveys for resolved tickets, hourly), and `auto_escalate_tickets` (escalate tickets unresolved after 48 h, hourly). `197_seed_interaction_permissions.sql` seeds the `interactions` RBAC module permissions (`interactions.*`, `follow_ups.*`, `surveys.*`, `escalations.*`) and assigns them to the default roles. New endpoints: full CRUD under `/interactions`, `/follow-up-reminders` (plus `GET /follow-up-reminders/due`, `POST /follow-up-reminders/:id/complete`), `/satisfaction-surveys` (plus `GET /satisfaction-surveys/metrics`, `POST /satisfaction-surveys/:id/{send,respond}`), `/escalations` (plus `GET /escalations/candidates`, `POST /escalations/:id/transition`), and the unified timeline at `GET /clients/:id/timeline`. New event-bus events with email/SSE/webhook hooks: `followup.due`, `survey.requested`, `ticket.escalated`.

> **Migrations 193–194 — Customer lifecycle (§1.2):** `193_create_customer_lifecycle_tables.sql` adds the `leads`, `service_orders`, `service_order_tasks`, and `winback_campaigns` tables. `194_seed_lifecycle_permissions.sql` seeds the `lifecycle` RBAC module permissions (`leads.*`, `service_orders.*`, `winback.*`, `lifecycle.view`) and assigns them to the default roles. New endpoints: full CRUD under `/leads` (plus `GET /leads/pipeline`, `POST /leads/:id/convert`), `/service-orders` (plus `GET/POST/PATCH /service-orders/:id/tasks`), `/winback-campaigns` (plus `GET /winback-campaigns/:id/targets`), and lifecycle analytics under `/lifecycle/churn` and `/lifecycle/at-risk`. Marking a service order done emits `service_order.activated`, which sends a welcome email/SMS. (Status transitions were simplified in migration 380 — see below.)
>
> **Migration 385 — Portal (subscriber self-service) password reset:** Adds `portal_reset_token_hash` and `portal_reset_token_expires` to `clients` (plus a non-unique lookup index on the hash column), mirroring migration 382's fix but for the client portal's separate auth stack (`clients.portal_password_hash`, not `users`) — previously a subscriber who forgot their portal password had no self-service recovery path at all; only a staff member manually resetting it via `portalAuthService.setPassword` worked. Adds `POST /portal/auth/password-reset/request` and `POST /portal/auth/password-reset` (both public, in `src/routes/portal.js`), a new `portalAuthService.requestPasswordReset`/`resetPassword`, and a dedicated `portalPasswordResetLimiter` (separate express-rate-limit instance/budget from the staff-side `passwordResetLimiter`, applied route-level per `portal.js`'s convention rather than `app.js`'s path-prefix convention). Anti-enumeration: the request endpoint returns an identical generic message whether the email is unknown, the account exists but has portal access never enabled (`portal_password_hash IS NULL`), or the account is `inactive` — none of those three cases mints a token or sends email, so forgot-password can never become a silent self-activation path for a portal account the ISP has not turned on. Reuses the existing `passwordResetEmail` template (reset URL: `${config.appUrl}/portal/reset-password?token=...`). On successful reset: clears `portal_login_attempts`/`portal_locked_until` (lockout-clear) and revokes all outstanding `portal_refresh_tokens` for the client (the portal's equivalent of the staff flow's session wipe). No new permission slug: portal routes are gated by client identity (`portalAuthenticate`), not RBAC.
>
> **Migration 384 — Atomic per-organization service-order-number sequence:** Adds `organization_order_sequences` (`organization_id` PRIMARY KEY, sentinel `0` = the NULL/single-tenant bucket; `next_number`), mirroring migration 381's pattern. Replaces the `SELECT COUNT(*) FROM service_orders WHERE organization_id <=> ?` → `SO-${cnt+1}` pattern in `lifecycleService.generateOrderNumber` (the same non-locking-read race migration 381 fixed for invoices — two concurrent `POST /service-orders` for the same org could both read the same count and both `INSERT` the same `order_number`, hitting the `uq_service_orders_org_number` unique-key 500) with the new exported `lifecycleService.nextOrderNumber(conn, orgId)` helper, an atomic `INSERT IGNORE` + `UPDATE ... SET next_number = LAST_INSERT_ID(next_number) + 1`. Seeded from existing data (including soft-deleted rows) so already-issued numbers are never reissued. `SO-` + zero-padded-6 formatting is unchanged. This closes the gap migration 381 explicitly left out of scope (see below).
>
> **Migration 382 — Password reset + email verification columns:** Adds `reset_token_hash`, `reset_token_expires`, `email_verify_token_hash`, and `email_verified_at` to `users` (plus non-unique lookup indexes on the two hash columns), closing a gap where `POST /auth/password-reset/request`, `POST /auth/password-reset`, and `POST /auth/verify-email` 500'd on every real call — the columns they read/wrote never existed. Also wires the previously-orphaned `passwordResetEmail`/`emailVerificationEmail` templates to actually send (`src/routes/auth.js`'s `/password-reset/request` handler; `authService.register()`), triggers a verification token on every new registration, and adds `POST /auth/verify-email/resend` (authenticated, no-op if already verified). `email_verified_at` is informational only — nothing gates login on it, so existing rows are left `NULL` (no backfill). No new permission slug: `/verify-email/resend` follows the same self-service `authenticate`-only pattern as `/change-password`.
>
> **Migration 381 — Atomic per-organization invoice-number sequence:** Adds `organization_invoice_sequences` (`organization_id` PRIMARY KEY, sentinel `0` = the NULL/single-tenant bucket; `next_number`). Replaces the `SELECT COUNT(*) FROM invoices WHERE organization_id = ?` → `INV-${cnt+1}` pattern (a non-locking read that two concurrent invoice-generation calls for the same org could both read identically, then both `INSERT` the same `invoice_number` and hit the `uq_invoices_org_number` unique-key 500) at all four generation sites — `billingService.generateInvoice`, `billingService.createOneOffInvoice`, `POST /invoices/generate`, and `POST /quotes/:id/convert-to-invoice` — with the new exported `billingService.nextInvoiceNumber(conn, orgId)` helper, an atomic `INSERT ... ON DUPLICATE KEY UPDATE next_number = LAST_INSERT_ID(next_number) + 1`. Seeded from existing data so already-issued numbers are never reissued. `INV-` + zero-padded-6 formatting is unchanged; numbers beyond 999999 just grow longer. (Service-order `SO-######` numbering was a separate, still-`COUNT(*)`-based helper — closed by migration 384, see above.)
>
> **Migration 380 — Simplified service-order flow:** Replaces the 5-state `service_orders.status` (`requested`→`approved`→`provisioning`→`activated`, or `cancelled`) with a 4-state flow: `new`→`in_process`→`done`, plus `cancelled` (reachable from `new` or `in_process`). Adds `started_at`/`completed_at` DATETIME columns; existing rows are remapped (`requested`/`approved`→`new`, `provisioning`→`in_process` with `started_at` backfilled, `activated`→`done` with `started_at`/`completed_at` backfilled) and `approved_at`/`approved_by`/`activated_at` are kept for history but no longer written. Also widens `clients.address` to `VARCHAR(500)` to match `leads.address`. Routes: `POST /service-orders/:id/{approve,provision,activate}` are removed and replaced by `POST /service-orders/:id/start` (transitions `new`→`in_process`; for `order_type = 'new_install'` this auto-creates and provisions a `pending` contract from the order's client/lead + plan — converting an unconverted lead on the fly — mirroring `POST /contracts`) and `POST /service-orders/:id/complete` (transitions `in_process`→`done`; body `{ billing: 'already_paid' | 'create_invoice', installation_fee?, description? }` — `create_invoice` raises a one-off issued invoice for the installation fee via `billingService.createOneOffInvoice` and activates the linked `pending` contract). `POST /service-orders/:id/cancel` is unchanged.

> **Migrations 190–192 — Subscriber profile management (§1.1):** `190_add_profile_fields_to_clients.sql` adds `latitude`, `longitude`, `geocoded_at`, `credit_score`, and `risk_rating` to `clients` and extends `client_type` with `corporate`. `191_create_client_custom_fields_table.sql` adds unlimited per-client key/value custom fields. `192_create_client_groups_table.sql` adds the `client_groups` table (family/account grouping) plus `clients.client_group_id`. New endpoints: `POST /clients/:id/geocode`, `GET/PUT/DELETE /clients/:id/custom-fields`, `GET/POST/DELETE /clients/:id/documents`, `GET /clients/:id/duplicates`, `GET /clients/duplicates/scan`, `POST /clients/:id/merge`, plus full CRUD under `/client-groups`. Geocoding requires `GOOGLE_MAPS_API_KEY`.

> **Migration 051 — Multi-currency ALTER:** `051_add_currency_to_financial_tables.sql` adds a `currency CHAR(3) NOT NULL DEFAULT 'USD'` column (ISO 4217 currency code) to `invoices`, `payments`, `credit_notes`, `quotes`, `plans`, and `expenses`. This is an ALTER TABLE migration applied after the initial schema creation.

> **Migration 053 — Preflight check procedure:** `053_create_preflight_check_event_scheduler.sql` creates the `preflight_check_event_scheduler()` stored procedure. It does not create a table. Call `CALL preflight_check_event_scheduler();` during deployment to verify the MySQL Event Scheduler is enabled before the application starts.

> **Migration 056 — Tax rate references ALTER:** `056_add_tax_rate_id_to_financial_tables.sql` adds a `tax_rate_id BIGINT UNSIGNED NULL` foreign key column to `invoices`, `quotes`, and `credit_notes`, linking them to the `tax_rates` master table. The existing `tax_rate` DECIMAL column is kept as a snapshot of the rate at document-creation time.

> **Migration 058 — Template FK on email_logs ALTER:** `058_add_template_id_to_email_logs.sql` adds a `template_id BIGINT UNSIGNED NULL` foreign key column to `email_logs`, linking each sent message to the `message_templates` table. The existing `template` VARCHAR column is kept for backward compatibility and free-text template names.

> **Migration 065 — Locale switch ALTER:** `065_add_locale_to_clients_and_organizations.sql` adds `locale ENUM('global','MX') NOT NULL DEFAULT 'global'` to both `clients` and `organizations`. Setting `locale = 'MX'` activates SAT CFDI 4.0 and IFT/CRT compliance requirements at the app layer. Existing clients with a CURP are back-filled to `'MX'`.

> **Migration 069 — SAT catalog seed:** `069_seed_sat_catalogs.sql` populates the six SAT CFDI 4.0 catalog tables (sat_regimen_fiscal, sat_uso_cfdi, sat_forma_pago, sat_metodo_pago, sat_tipo_comprobante, sat_moneda) with official SAT values. Uses `INSERT IGNORE` for idempotent re-runs.

> **Migration 074 — Mexico payment methods ALTER:** `074_add_mexico_payment_methods.sql` extends `payments.payment_method` with `oxxo_pay`, `spei`, `codi`, `convenience_store`, and `digital_wallet`, and adds `sat_forma_pago VARCHAR(2)`, `clabe VARCHAR(18)`, and `bank_name VARCHAR(100)` columns.

> **Migration 078 — MX contract template FK ALTER:** `078_add_mx_template_to_contracts.sql` adds `contract_template_mx_id BIGINT UNSIGNED NULL` to `contracts`, linking each contract to an IFT/CRT-registered Carta de Adhesión template. NULL for global clients.

> **Migration 082 — SAT product/unit catalog seed:** `082_seed_sat_clave_prod_serv_and_unidad.sql` populates the ISP-relevant subset of the SAT `c_ClaveProdServ` (7 codes including `81161700` Internet, `81161500` VoIP, `01010101` No aplica) and `c_ClaveUnidad` (6 codes including `E48` Service unit, `MON` Month, `H87` Piece) catalog tables. Uses `INSERT IGNORE` for idempotent re-runs.

> **Migration 084 — CFDI XML/PDF storage ALTER:** `084_add_xml_pdf_storage_to_cfdi_documents.sql` adds `signed_xml LONGTEXT NULL` (complete timbrado XML from PAC — SAT requires 5-year retention), `xml_file_id BIGINT UNSIGNED NULL` (FK to `files` for archival/object-storage), and `pdf_file_id BIGINT UNSIGNED NULL` (FK to `files` for generated PDF) to `cfdi_documents`.

> **Migration 086 — MX locale backfill for company clients:** `086_backfill_mx_locale_for_company_clients.sql` fixes an incomplete backfill from migration 065 — sets `locale = 'MX'` for clients that have a `client_mx_profiles` row but were left on `locale = 'global'` (company clients without a CURP). Also back-fills organizations with an `organization_mx_profiles` row.

> **Migration 087 — MX locale enforcement triggers:** `087_create_mx_locale_enforcement_triggers.sql` adds BEFORE INSERT / BEFORE UPDATE triggers on all MX-specific tables (`client_mx_profiles`, `organization_mx_profiles`, `cfdi_documents`, `concession_titles`, `contract_templates_mx`, `regulatory_filings`, `ift_statistical_reports`) to enforce that the referenced client or organization has `locale = 'MX'`. Also guards `contracts.contract_template_mx_id` — a non-NULL value requires the contract's client to have `locale = 'MX'`. Raises SQLSTATE '45000' on violation.

> **Migration 088 — Locale downgrade guard triggers:** `088_create_locale_downgrade_guard_triggers.sql` adds BEFORE UPDATE triggers on `clients` and `organizations` to prevent changing `locale` from `'MX'` to `'global'` when MX-dependent records exist (MX profiles, CFDI documents, concession titles, contract templates, regulatory filings, IFT statistical reports). Raises SQLSTATE '45000' on violation.

> **Migration 091 — Factura pública stamping safeguards:** `091_add_factura_publica_stamping_safeguards.sql` adds a stored function and two triggers that enforce business rules at stamp time:
> - **`fn_predominant_forma_pago(p_factura_publica_invoice_id)`** — stored function that calculates the predominant SAT `FormaPago` code for a factura pública by summing `payments.amount` grouped by `sat_forma_pago` across all linked invoices and returning the code with the highest total. Defaults to `'99'` (Por definir) when no payments exist or when two or more codes tie for the highest total. Call this function at stamp time to populate `cfdi_documents.forma_pago`. Business rule (SAT Anexo 20 CFDI 4.0): *"En caso de que el pago se realice utilizando más de una forma de pago, se debe indicar la que represente el monto mayor."*
> - **`trg_factura_publica_invoices_bu`** — BEFORE UPDATE trigger on `factura_publica_invoices` that prevents `status` from being set to `'stamped'` if any invoice linked via `factura_publica_invoice_items` does not have `status = 'paid'`. Raises SQLSTATE '45000'. Business rule: including unpaid invoices in a stamped CFDI forces the ISP to pay taxes on revenue it has not yet collected; if the client cancels or never pays, those taxes cannot be recovered.
> - **`trg_factura_publica_invoice_items_bi`** — BEFORE INSERT trigger on `factura_publica_invoice_items` that rejects linking an invoice whose `status` is not `'paid'`. Raises SQLSTATE '45000'. Enforces the same unpaid-invoice exclusion incrementally at insert time.

> **Migration 092 — Exportacion field ALTER:** `092_add_exportacion_to_cfdi_documents.sql` adds `exportacion ENUM('01','02','03') NOT NULL DEFAULT '01'` to `cfdi_documents`. This is a mandatory SAT CFDI 4.0 attribute on the `<Comprobante>` node: `01` = no export (domestic, most common for ISPs), `02` = definitive export, `03` = temporary export. Omitting it causes PAC rejection.

> **Migration 093 — Complemento de Pago 2.0 tax support:** `093_add_complemento_pago_2_tax_support.sql` adds `objeto_imp_dr ENUM('01','02','03') NOT NULL DEFAULT '02'` to `cfdi_payment_complement_items` (ObjetoImpDR on each DoctoRelacionado) and creates the `cfdi_payment_complement_item_taxes` table for per-document-related tax breakdown (`ImpuestosP`). Required by SAT Complemento de Pago 2.0 when `objeto_imp_dr = '02'`.

> **Migration 094 — CFDI document FK constraints:** `094_add_fks_cfdi_documents_to_sat_catalogs.sql` adds foreign key constraints from `cfdi_documents` to SAT catalog tables: `tipo_comprobante` → `sat_tipo_comprobante`, `uso_cfdi` → `sat_uso_cfdi`, `metodo_pago` → `sat_metodo_pago`, `forma_pago` → `sat_forma_pago`, `moneda` → `sat_moneda`. Prevents invalid SAT codes from being stored.

> **Migration 095 — CFDI conceptos FK constraints:** `095_add_fks_cfdi_conceptos_to_sat_catalogs.sql` adds foreign key constraints from `cfdi_conceptos` to SAT catalog tables: `clave_prod_serv` → `sat_clave_prod_serv`, `clave_unidad` → `sat_clave_unidad`. Prevents invalid SAT product/service and unit codes on CFDI line items.

> **Migration 096 — SAT catalog seed expansion:** `096_seed_missing_sat_catalog_entries.sql` adds missing `sat_regimen_fiscal` codes (`607` Enajenación o Adquisición de Bienes, `609` Consolidación, `611` Ingresos por Dividendos, `615` Ingresos por obtención de premios) and `sat_uso_cfdi` codes (`D05`–`D10`: medical insurance premiums, school transportation, savings plan deposits, tuition, voluntary SAR contributions, major medical insurance premiums). Uses `INSERT IGNORE` for idempotent re-runs.

> **Migration 097 — Facturar guard triggers:** `097_add_facturar_guard_triggers.sql` adds BEFORE INSERT / BEFORE UPDATE triggers on `contracts` that raise SQLSTATE '45000' when `facturar = TRUE` and the client's `locale != 'MX'`. Prevents non-MX clients from being assigned to the Mexican e-invoicing workflow.

> **Migration 098 — Country default NULL:** `098_set_country_default_null.sql` changes the DEFAULT for `clients.country` and `organizations.country` from `'US'` to `NULL`. Existing rows are not modified — only future inserts without an explicit country value will receive `NULL` instead of `'US'`.

> **Migration 099 — Fix XXX currency description:** `099_fix_xxx_currency_description.sql` updates `sat_moneda` to set the `XXX` currency description to the official SAT text: *"Los códigos asignados para las transacciones en que no intervenga ninguna moneda"* (previously incorrectly set to *"Los derechos en esta divisa"*).

> **Migration 100 — CSD expiry monitoring task:** `100_seed_csd_expiry_scheduled_task.sql` inserts a system-level scheduled task (`csd_expiry_monitor`, cron `0 8 * * *`) that checks `organization_mx_profiles.csd_valid_to` for certificates expiring within 30 days and generates email + in-app notifications. Uses `INSERT IGNORE` for idempotent re-runs. If a CSD expires, the ISP cannot stamp any new CFDIs.

> **Migration 101 — Payment gateways:** `101_create_payment_gateways_table.sql` creates the `payment_gateways` table for per-organization payment provider configuration (Stripe, Conekta, OpenPay, MercadoPago, PayPal, manual, other). Stores environment (sandbox/production), encrypted secret key, optional public key, webhook signing secret, default flag, and a JSON column for provider-specific settings.

> **Migration 102 — Payment transactions:** `102_create_payment_transactions_table.sql` creates the `payment_transactions` table — a raw gateway transaction log for every payment attempt. Records the provider's reference ID, gateway status (pending/succeeded/failed/refunded/disputed/cancelled), raw request/response JSON, webhook payload, and a unique idempotency key to prevent duplicate charges.

> **Migration 103 — Recurring payment profiles:** `103_create_recurring_payment_profiles_table.sql` creates the `recurring_payment_profiles` table for stored card tokens per client (autopay). Holds the gateway's customer or card token, card brand, last four digits, expiry month/year, default flag, and lifecycle status (active/expired/revoked).

> **Migration 104 — Suspension rules:** `104_create_suspension_rules_table.sql` creates the `suspension_rules` table for configurable auto-suspend/disconnect rules per organization. Each rule specifies a days-past-due threshold, grace period, action (auto_suspend/notify_only/auto_disconnect), optional advance notification window, and optional plan-ID scoping via JSON.

> **Migration 105 — Suspension logs:** `105_create_suspension_logs_table.sql` creates the `suspension_logs` table — a full audit trail of suspend/unsuspend/disconnect/reconnect events per contract. Records the triggering rule (NULL for manual actions), performer, RADIUS CoA sent/response, linked invoice, and suspend/restore timestamps.

> **Migration 106 — CSD certificates:** `106_create_csd_certificates_table.sql` creates the `csd_certificates` table for storing CSD `.cer`/`.key` files per organization. Holds PEM-encoded public certificate, application-encrypted private key, optional encrypted passphrase, SHA-256 fingerprint (unique), certificate number (NoCertificado, unique), RFC, validity window, and active/expired/revoked status. The `valid_to` column is used by the CSD expiry monitor task (migration 100).

> **Migration 107 — PAC providers:** `107_create_pac_providers_table.sql` creates the `pac_providers` table for PAC (Proveedor Autorizado de Certificación) credentials and endpoint configuration. Supports Finkok, SW Sapien, Digicel, Comercio Digital, FacturAPI with sandbox/production environments. Unique constraint on `(organization_id, provider_name, environment)`.

> **Migration 108 — Webhooks:** `108_create_webhooks_table.sql` creates the `webhooks` table for outbound webhook registrations per organization. Each record defines a target URL, encrypted HMAC signing secret, JSON array of subscribed event names, max retries (default 5), and timeout (default 30s).

> **Migration 109 — Webhook deliveries:** `109_create_webhook_deliveries_table.sql` creates the `webhook_deliveries` table — a per-attempt delivery log for outbound webhooks. Records HTTP status code, response body, response time, attempt number, delivery status (pending/success/failed/retrying), and next retry timestamp.

> **Migration 110 — Organization users:** `110_create_organization_users_table.sql` creates the `organization_users` pivot table linking users to organizations with per-organization roles (owner/admin/manager/technician/billing/readonly). Unique on `(organization_id, user_id)`. Enables multi-tenant user membership where one user account can belong to multiple organizations.

> **Migration 111 — Plan add-ons:** `111_create_plan_addons_table.sql` creates the `plan_addons` catalog table for upsellable add-ons per organization — static IP, extra IP block, extra bandwidth, equipment rental, or other. Stores price, billing cycle (monthly/one-time/yearly), taxability flag, and availability status.

> **Migration 112 — Contract add-ons:** `112_create_contract_addons_table.sql` creates the `contract_addons` table for add-ons attached to a specific client contract. References the plan_addons catalog and stores contracted quantity, negotiated unit price, start/end dates, and lifecycle status (active/cancelled/expired).

> **Migration 113 — Speed tests:** `113_create_speed_tests_table.sql` creates the `speed_tests` table for recording speed test results from multiple sources (client_portal/technician/automated_probe/external). Stores download/upload Mbps, latency, jitter, packet loss, observed IP address, and tested-at timestamp. Optional FKs to clients, contracts, and devices.

> **Migration 114 — Ticket SLA events:** `114_create_ticket_sla_events_table.sql` creates the `ticket_sla_events` table for SLA tracking per support ticket. Records milestones (first_response/resolution/escalation/breach_warning/breach), target deadline, actual timestamp, breach flag, and minutes past deadline. FK to `sla_definitions` (migration 063).

> **Migration 115 — SMS logs:** `115_create_sms_logs_table.sql` creates the `sms_logs` table for SMS and WhatsApp notification logging per organization. Complements `email_logs` for non-email channels. Captures direction (outbound/inbound), provider name, provider message ID, delivery status, error details, per-message cost, and send/delivery timestamps. FK to `message_templates`.

> **Migration 116 — Revenue summary:** `116_create_revenue_summary_table.sql` creates the `revenue_summary` materialized table for MRR/churn/ARPU reporting — populated by a scheduled task, not a SQL VIEW. One row per organization per calendar month per currency. Stores MRR, active clients/contracts, new/churned contracts, ARPU, total revenue/collected/outstanding.

> **Migration 117 — Network health snapshots:** `117_create_network_health_snapshots_table.sql` creates the `network_health_snapshots` table for aggregated daily device and link health data. Stores uptime %, avg/max latency, avg/peak throughput in/out, packet loss, and total downtime minutes. Composite indexes on `(device_id, snapshot_date)` and `(network_link_id, snapshot_date)`.

> **Migration 118 — CFDI cancellations:** `118_create_cfdi_cancellations_table.sql` creates the `cfdi_cancellations` table — a SAT CFDI cancellation audit trail. Records the cancellation reason code (motivo: 01=con relación, 02=sin relación, 03=no se llevó a cabo, 04=nominativa en CFDI global), optional replacement UUID (folio_sustitucion, required for motivo 01), PAC response status, raw acuse XML, and requesting user. FK to `cfdi_documents`, `pac_providers`, and `users`.

> **Migration 119 — Seed default roles and permissions:** `119_seed_default_roles_and_permissions.sql` inserts the five built-in system roles (`admin`, `billing`, `support`, `technician`, `readonly`) with `is_system = TRUE` so they cannot be deleted. Also inserts all granular permission slugs (e.g. `clients.view`, `invoices.create`, `devices.delete`, `audit_logs.view`) grouped by module, and the `role_permissions` mappings: `admin` gets all permissions; `billing` gets billing/financial access; `support` gets client/ticket access; `technician` gets device/job/inventory access; `readonly` gets all `*.view` and `*.export` permissions. Uses `INSERT IGNORE` for idempotent re-runs.

> **Migration 120 — Seed default settings:** `120_seed_default_settings.sql` populates the `settings` key-value table with 25 default values covering currency (`default_currency = USD`), invoice/quote/credit-note prefixes, SMTP configuration, SNMP polling interval and community, company profile fields, locale/date-format/pagination preferences, session and login security parameters, and automation flags (`auto_suspend_enabled`, `auto_invoice_enabled`). Uses `INSERT IGNORE` — administrator-customised values are never overwritten on re-runs.

> **Migration 121 — Seed default tax rates:** `121_seed_default_tax_rates.sql` inserts four globally applicable default tax rates (`organization_id = NULL`): Tax Exempt (0%), Standard Tax 8%, IVA 16% (Mexico), and GST 5% (Canada). Uses `WHERE NOT EXISTS` guards for full idempotency since the `tax_rates` table does not carry a `UNIQUE` constraint on `name` alone.

> **Migration 122 — Seed default suspension rule:** `122_seed_default_suspension_rule.sql` inserts a default auto-suspend rule into `suspension_rules` for the first organization (id = 1): 30 days past due, 5-day grace period, action `auto_suspend`. Uses `WHERE NOT EXISTS` to be idempotent. Because `suspension_rules.organization_id` is `NOT NULL`, this seed targets org id = 1; administrators should add per-organization rules as part of tenant onboarding.

> **Migration 123 — Seed scheduled tasks for core automation:** `123_seed_scheduled_tasks_core_automation.sql` inserts the five system-level automation tasks that drive FireISP's main operational loops: `auto_generate_invoices` (daily at 01:00), `auto_suspend_overdue` (daily at 06:00), `radius_sync` (every 5 min), `populate_revenue_summary` (monthly on the 1st at 02:00), and `populate_network_health_snapshots` (daily at 04:00). All tasks use `organization_id = NULL` (global) and `is_enabled = TRUE`. Uses `INSERT IGNORE` on the `UNIQUE KEY (organization_id, task_name)`.

> **Migration 124 — Add currency to expenses (idempotent guard):** `124_add_currency_to_expenses.sql` adds `expenses.currency CHAR(3) NOT NULL DEFAULT 'USD'` after the `amount` column for multi-currency expense tracking. The migration is wrapped in a stored-procedure guard that checks `INFORMATION_SCHEMA.COLUMNS` before issuing the `ALTER TABLE`, making it a safe no-op on installations where migration 051 already applied the same column.

> **Migration 125 — Add tax_rate_id to line-item tables:** `125_add_tax_rate_id_to_line_item_tables.sql` adds a `tax_rate_id BIGINT UNSIGNED NULL` foreign-key column to `invoice_items`, `quote_items`, and `credit_note_items`. `NULL` means "inherit the rate from the parent document". This enables per-line-item tax rates for mixed-rate invoices common in multi-tax-rate jurisdictions (e.g. different rates for hardware vs. services). `ON DELETE SET NULL` prevents cascading deletes when a `tax_rates` row is removed.

> **Migration 126 — Payment allocation balance guard triggers:** `126_payment_allocation_balance_guard_triggers.sql` adds four `BEFORE INSERT / BEFORE UPDATE` triggers on `payment_allocations` that enforce two financial integrity rules at the database level: (1) the total allocated amount for a payment cannot exceed `payments.amount`, and (2) the total allocated amount for an invoice cannot exceed `invoices.total`. Both violations raise `SQLSTATE '45000'` with descriptive messages. Uses `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER` for safe re-runs.

> **Migration 127 — Inventory stock negative guard trigger:** `127_inventory_stock_negative_guard_trigger.sql` adds a `BEFORE UPDATE` trigger on `inventory_stock` that raises `SQLSTATE '45000'` when a stock update would set `quantity < 0`. This prevents physically impossible inventory state from silently corrupting reports and downstream job fulfillment. Uses `DROP TRIGGER IF EXISTS` for safe re-runs.

> **Migration 128 — PPPoE contract RADIUS consistency trigger:** `128_connection_type_radius_consistency_trigger.sql` adds a `BEFORE UPDATE` trigger on `contracts` that raises `SQLSTATE '45000'` when a contract with `connection_type IN ('pppoe', 'pppoe_dual')` is activated (`status` changed to `'active'`) without at least one corresponding `radius` row. Contracts start in `pending` status so RADIUS accounts can be provisioned before activation; the guard fires only at activation time. Uses `DROP TRIGGER IF EXISTS` for safe re-runs.

> **Migration 129 — Composite indexes for query performance:** `129_add_composite_indexes_for_query_performance.sql` adds five composite indexes for common multi-column query patterns: `idx_invoices_currency_status ON invoices(currency, status)`, `idx_payment_transactions_gateway_id_status ON payment_transactions(payment_gateway_id, gateway_status)`, `idx_expenses_currency ON expenses(currency)`, `idx_contracts_client_facturar ON contracts(client_id, facturar)`, and `idx_suspension_logs_contract_created ON suspension_logs(contract_id, created_at)`. Each index is guarded via `INFORMATION_SCHEMA.STATISTICS` in a stored procedure for safe re-runs. Note: `webhook_deliveries.next_retry_at` already has a single-column index from migration 109.

> **Migration 130 — FireRelay nodes:** `130_create_firerelay_nodes_table.sql` creates the `firerelay_nodes` table — a registry of all nodes in a FireRelay cluster. Only used when `FIRERELAY_MODE = master`. Tracks node ID, API URL, status (active/draining/maintenance/offline), resource metrics (CPU %, memory %, disk %, DB size), client and device counts, uptime, and last-seen heartbeat.

> **Migration 131 — FireRelay client routing:** `131_create_firerelay_client_routing_table.sql` creates the `firerelay_client_routing` table — maps each `client_id` to the FireRelay node that owns it. Only used when `FIRERELAY_MODE = master`. Foreign key to `firerelay_nodes` with `ON DELETE RESTRICT`.

> **Migration 132 — Webhook events:** `132_create_webhook_events_table.sql` creates the `webhook_events` table for inbound payment gateway webhook events. Stores raw JSON payloads from Stripe, Conekta, and other providers with deduplication via unique `(provider, provider_event_id)` constraint. Tracks processing status (received/processing/processed/failed/ignored) and links to `payment_transactions` after reconciliation.

> **Migration 133 — Idempotency keys:** `133_create_idempotency_keys_table.sql` creates the `idempotency_keys` table for preventing duplicate payment charges. Stores client-supplied unique keys scoped per organization with cached HTTP response codes and bodies. Keys expire after 24 hours and are cleaned up by a scheduled task.

> **Migration 134 — Alert rules:** `134_create_alert_rules_table.sql` creates the `alert_rules` table for configurable monitoring alert rules per organization. Each rule defines a metric (cpu_usage, memory_usage, signal_strength, latency_ms, packet_loss, uptime), comparison operator, threshold, evaluation window in minutes, severity (info/warning/major/critical), optional auto-outage creation flag, and notification channels (email/SMS/SSE/webhook as JSON array).

> **Migration 135 — Alert events:** `135_create_alert_events_table.sql` creates the `alert_events` table — a log of triggered alert events. Records the firing alert rule, device, current vs threshold values, and lifecycle status (triggered/acknowledged/resolved) with acknowledgement and resolution timestamps.

> **Migration 136 — 2FA / TOTP ALTER:** `136_add_totp_to_users.sql` adds `totp_secret VARCHAR(255) NULL`, `totp_enabled BOOLEAN NOT NULL DEFAULT FALSE`, and `totp_backup_codes JSON NULL` to `users` for two-factor authentication support. Uses an idempotent stored procedure guard to skip if columns already exist.

> **Migration 137 — Data cap ALTER:** `137_add_data_cap_to_plans.sql` adds `data_cap_gb DECIMAL(10,2) NULL` to `plans` for monthly data cap in GB (NULL = unlimited). Uses an idempotent stored procedure guard.

> **Migration 138 — Seed alert evaluation task:** `138_seed_alert_evaluation_task.sql` inserts the `alert_evaluation` scheduled task (cron `*/5 * * * *`) that evaluates monitoring alert rules against current SNMP metrics every 5 minutes.

> **Migration 139 — Seed recurring charge task:** `139_seed_recurring_charge_task.sql` inserts the `process_recurring_charges` scheduled task (cron `0 7 * * *`) that auto-charges active recurring payment profiles with pending invoices daily at 07:00.

> **Migration 140 — Login lockout ALTER:** `140_add_login_lockout_to_users.sql` adds `failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0` and `locked_until TIMESTAMP NULL` to `users` for brute-force account lockout protection.

> **Migration 141 — Composite indexes (batch 2):** `141_add_composite_indexes.sql` adds ten composite indexes for high-traffic query patterns: `idx_invoices_client_created`, `idx_invoices_status_due`, `idx_payments_contract_date`, `idx_payments_client_created`, `idx_connection_logs_contract_start`, `idx_tickets_client_status`, `idx_tickets_assigned_status`, `idx_webhook_deliveries_status_created`, `idx_audit_logs_entity_type_id`, and `idx_contracts_client_status`.

> **Migration 142 — Webhook dead letter ALTER:** `142_add_webhook_dead_letter.sql` adds `dead_letter` to the `webhook_deliveries.status` ENUM for deliveries that have exhausted all retry attempts. Adds `idx_webhook_deliveries_dead_letter` index for dead-letter dashboard queries.

> **Migration 143 — Optimistic locking ALTER:** `143_add_version_columns.sql` adds `version INT UNSIGNED NOT NULL DEFAULT 1` to `invoices`, `contracts`, `payments`, and `clients` for optimistic concurrency control.

> **Migration 144 — Billing period uniqueness:** `144_add_billing_period_unique_constraint.sql` adds a unique composite index `uq_billing_period_contract_dates (contract_id, period_start, period_end)` to `billing_periods` to prevent duplicate invoices for the same contract and billing period.

> **Migration 145 — Seed data retention task:** `145_seed_data_retention_task.sql` inserts the `data_retention` scheduled task (cron `0 3 * * *`) that purges old audit logs, alert events, webhook deliveries, and expired idempotency keys daily at 03:00.

> **Migration 146 — Credit note invoice cap triggers:** `146_credit_note_invoice_total_guard_trigger.sql` adds BEFORE INSERT / BEFORE UPDATE triggers on `credit_notes` that prevent the sum of credit note totals (excluding cancelled) from exceeding the linked invoice total. Raises SQLSTATE '45000' on over-credit.

> **Migration 147 — Audit log immutability triggers:** `147_audit_log_immutability_triggers.sql` adds BEFORE UPDATE / BEFORE DELETE triggers on `audit_logs` that block any modification or removal of audit records. Audit logs are append-only for compliance; the data-retention service uses administrative privileges to bypass when needed. Raises SQLSTATE '45000'.

> **Migration 148 — CFDI document immutability trigger:** `148_cfdi_document_immutability_trigger.sql` adds a BEFORE UPDATE trigger on `cfdi_documents` that prevents modification of stamped (`sat_status = 'vigente'`) documents' financial fields (subtotal, total, UUID, XML, receptor data, etc.) per SAT Anexo 20. Only `sat_status` changes (for the cancellation flow) and non-financial metadata (pdf_url, updated_at) remain modifiable. Raises SQLSTATE '45000'.

> **Migration 149 — Contract status FSM trigger:** `149_contract_status_fsm_trigger.sql` adds a BEFORE UPDATE trigger on `contracts` that enforces valid status transitions: `pending → active|cancelled`, `active → expired|cancelled`. Both `expired` and `cancelled` are terminal states. Raises SQLSTATE '45000' on invalid transitions.

> **Migration 150 — Outage temporal logic triggers:** `150_outage_temporal_logic_trigger.sql` adds BEFORE INSERT / BEFORE UPDATE triggers on `outages` that ensure `resolved_at` is always after `started_at` when set. Prevents nonsensical duration calculations and corrupt SLA/uptime reporting. Raises SQLSTATE '45000'.

> **Migration 151 — Soft-delete columns:** `151_add_soft_delete_columns.sql` adds a nullable `deleted_at DATETIME` column and a corresponding index to 62 resource tables (users, clients, contracts, invoices, payments, devices, tickets, and all other major entities). Enables archive-on-delete instead of hard `DELETE`, preserving data integrity and audit trails. The `BaseModel.delete()` method sets `deleted_at = NOW()` while `forceDelete()` performs a hard delete; `restore()` clears the column.

> **Migration 152 — Refresh token rotation:** `152_add_refresh_token_rotation.sql` adds a `token_family VARCHAR(255)` column and index to `user_sessions`. The family identifier links all refresh tokens issued from one login session, enabling server-side reuse detection: if an already-rotated token is presented, all sessions in the same family are revoked to mitigate refresh token theft.

> **Migration 153 — Payment retries table:** `153_create_payment_retries_table.sql` creates the `payment_retries` table that tracks failed payment charges and schedules automatic retry attempts. Each row represents a retry schedule for a failed `payment_transactions` record. Retries follow exponential backoff (4 h → 24 h → 72 h, 3 attempts maximum). Stores attempt count, next retry timestamp, last error, status (`pending` / `processing` / `succeeded` / `exhausted` / `cancelled`), and FK links to the original transaction, client, invoice, and recurring payment profile.

> **Migration 154 — Seed payment retry task:** `154_seed_payment_retry_task.sql` inserts the `retry_failed_charges` scheduled task (cron `0 * * * *` — hourly) that processes pending payment retries whose `next_retry_at` has passed. Uses `INSERT IGNORE` for idempotency.

> **Migration 155 — Seed billing cycle task:** `155_seed_billing_cycle_task.sql` inserts the `billing_cycle` scheduled task (cron `0 2 * * *` — daily at 02:00, priority `high`, timeout 600 s) that orchestrates the full automated revenue engine: auto-generate invoices → email invoice to client → send suspension warning emails for overdue contracts approaching the rule threshold → suspend contracts past the `days_past_due` limit and email post-suspension confirmation. Dispatched by `taskRunner.runBillingCycle()`. Uses `INSERT IGNORE` for idempotency.

> **Migration 156 — Seed database backup task:** `156_seed_database_backup_task.sql` inserts the `database_backup` scheduled task (cron `0 3 * * *` — daily at 03:00 UTC, priority `normal`, timeout 1800 s, 2 retries) that runs `mysqldump`, compresses the output with gzip, saves it locally in `storage/backups/` (retaining the last 7 copies), and uploads it to S3-compatible cloud storage (AWS S3 or Backblaze B2) when `BACKUP_S3_BUCKET`/`BACKUP_S3_REGION`/`BACKUP_S3_ACCESS_KEY`/`BACKUP_S3_SECRET_KEY` are configured. Cloud upload failure is non-fatal — the local copy is retained. Uses `INSERT IGNORE` for idempotency.

> **Migration 157 — IFT statistical report alignment ALTER:** `157_align_ift_statistical_reports_with_ift_format.sql` aligns `ift_statistical_reports` with the IFT *Formato Estadístico — Servicio Fijo de Internet* required fields (see [`docs/ift-statistical-report-schema-review.md`](docs/ift-statistical-report-schema-review.md)). Adds `concession_title_id BIGINT UNSIGNED NULL` (FK to `concession_titles`, IFT F2), `subscribers_by_municipality JSON NULL` (INEGI municipality-code breakdown, IFT F5), `subscribers_by_customer_type JSON NULL` (residential/business counts, IFT F11), `subscribers_by_payment_modality JSON NULL` (pospago/prepago/empaquetado counts, IFT F12), and `notes TEXT NULL` (free-form filing comments).

> **Migration 158 — FireRelay node on devices + config backup task:** `158_add_firerelay_node_to_devices_and_seed_config_backup_task.sql` adds `firerelay_node_id VARCHAR(64) NULL` to `devices` (with `idx_devices_firerelay_node_id` index) — records which FireRelay agent can reach the device via the RouterOS API. No FK is added because the agent connection is the authoritative reachability source and standalone-mode deployments may have no `firerelay_nodes` rows. Also seeds the `config_backup_pull` scheduled task (cron `0 2 * * *`, daily at 02:00 UTC, 2 retries, 3600 s timeout) that pulls RouterOS `/export` configs from all devices with a `firerelay_node_id` and stores versioned snapshots in `device_config_backups` with SHA-256 deduplication. Uses `INSERT IGNORE` for idempotency.

> **Migration 159 — Auto-create ticket on alert:** `159_add_auto_create_ticket_to_alert_rules.sql` adds `auto_create_ticket BOOLEAN NOT NULL DEFAULT FALSE` to `alert_rules`. When enabled, the alert evaluation task automatically creates a support ticket for each triggered alert event with severity `critical` or `high`. The ticket is linked to the device, client, or site referenced in the alert and pre-populated with the alert threshold breach details.

> **Migration 160 — Portal credentials on clients:** `160_add_portal_credentials_to_clients.sql` adds `portal_email VARCHAR(255) NULL` (UNIQUE, nullable for clients without portal access) and `portal_password_hash VARCHAR(255) NULL` to `clients` for self-service portal authentication. Portal credentials are separate from administrative user credentials; clients can log in with their portal_email to view invoices, submit tickets, run speed tests, and manage payment methods.

> **Migration 161 — Portal refresh tokens table:** `161_create_portal_refresh_tokens_table.sql` creates the `portal_refresh_tokens` table that stores SHA-256 hashed refresh tokens for long-lived client portal authentication. Each row links to a `client_id`, includes an `expires_at` timestamp, and supports revocation via `revoked_at`. Complements the portal credentials added in migration 160; enables "remember me" sessions without exposing long-lived access tokens.

> **Migration 162 — Seed webhook retry task:** `162_seed_webhook_retry_task.sql` inserts the `webhook_retry` scheduled task (cron `*/10 * * * *` — every 10 minutes) that processes pending webhook deliveries whose `next_retry_at` has passed and status is `pending` or `retrying`. Implements exponential backoff (5 min → 15 min → 60 min → 6 h → 24 h, 5 attempts maximum). Uses `INSERT IGNORE` for idempotency.

> **Migration 163 — SNMP traps table:** `163_create_snmp_traps_table.sql` creates the `snmp_traps` table that stores unsolicited SNMP trap messages received from network devices. The trap receiver listens on UDP (port 1620 by default, configurable via `SNMP_TRAP_PORT`). Each row captures the device IP, trap type (coldStart, warmStart, linkDown, linkUp, authenticationFailure, egpNeighborLoss, enterpriseSpecific, unknown), raw OID, timestamp, uptime, variable bindings (varbinds) as JSON, and optional FK link to a known device. Enables automated alerting on device reboots, link failures, and authentication failures. Partitioned by month with 6-month retention.

> **Migration 164 — DR drill logs table + quarterly task:** `164_create_dr_drill_logs.sql` creates the `dr_drill_logs` table to record the outcome of each automated quarterly DR-drill run (Phase 1: backup + size verification, Phase 4: referential-integrity + financial-consistency checks). The drill is NON-DESTRUCTIVE — Phases 2 (drop) and 3 (restore) remain manual per `docs/dr-drill.md`. Also seeds the `quarterly_dr_drill` scheduled task (cron `0 2 1 1,4,7,10 *` — 02:00 on 1 Jan / 1 Apr / 1 Jul / 1 Oct, 1 retry, 3600 s timeout). Drill results (pass/fail/error) and an overdue flag are surfaced in the admin frontend on every login for compliance visibility.

> **Migration 165 — SSO configuration tables (P2.1):** `165_create_sso_configs.sql` creates three tables for per-organization single sign-on:
> - **`organization_sso_configs`** — one row per `(organization_id, provider_type)` (SAML 2.0 or OIDC); holds all IdP connection settings (SAML entity ID / SSO URL / SLO URL / X.509 cert / SP private key; OIDC issuer / client ID / client secret), attribute-mapping JSON, auto-provisioning flag, and the default role assigned to new SSO users. Unique constraint on `(organization_id, provider_type)`.
> - **`organization_sso_group_mappings`** — maps exact IdP group names to FireISP roles; evaluated at login to give authenticated users their correct role. Unique constraint on `(sso_config_id, idp_group)`.
> - **`sso_auth_states`** — short-lived OIDC state/nonce store for the authorization-code flow; rows expire after 10 minutes and should be purged by a cleanup task. Unique constraint on `state`.

> **Migration 166 — Per-tenant resource quotas:** `166_create_organization_quotas.sql` creates the `organization_quotas` table that stores optional upper bounds per organization for four resources: `max_clients` (active client records), `max_devices` (active device records), `max_storage_mb` (sum of all org-owned `files.file_size`), and `max_scheduled_tasks` (org-scoped scheduled task rows). A `NULL` value in any limit column means "unlimited" for that resource. A row is created only when a quota is first configured; the absence of a row is also treated as unlimited. The `checkQuota` middleware enforces these limits at the API layer before the relevant creation handlers. Unique constraint on `organization_id`.

> **Migration 167 — Per-tenant database isolation config:** `167_create_organization_database_configs.sql` creates the `organization_database_configs` control-plane table. One row per organization (unique constraint). Stores `isolation_mode` (`shared` default, `isolated` opt-in), isolated database host, port, name, user, AES-256-GCM-encrypted password (`db_password_encrypted`), SSL flag, and `last_verified_at` timestamp. When `isolation_mode = 'isolated'` and a valid connection config is present, `src/config/database.js` routes every DB operation for that organization to a dedicated MySQL pool (cached in memory, invalidated on config update). Admin endpoints: `GET/PUT /api/v1/organizations/:id/database-isolation` (masked config), `POST /api/v1/organizations/:id/database-isolation/test` (connectivity check + records `last_verified_at`). `FK ON DELETE CASCADE` from `organizations`.

> **Migration 168 — PROFECO complaint tracking:** `168_create_profeco_complaints_table.sql` creates the `profeco_complaints` table for ISPs subject to Mexico's PROFECO (Procuraduría Federal del Consumidor) CONCILIANET obligations. One row per complaint folio. Stores `folio_profeco` (official CONCILIANET folio, nullable until assigned), `consumer_name`, `consumer_email/phone`, `service_type`, `complaint_category`, `description`, `status` (`received` → `in_process` → `resolved` / `escalated`), `resolution_notes`, `received_at`, `response_deadline`, `resolved_at`, `submitted_by` (FK to users), and optional FKs to `clients` and `tickets`. Unique constraint on `(organization_id, folio_profeco)`. Supports quarterly export for regulatory filing.

> **Migration 169 — AI Reply Assistant tables + device/link columns:** `169_ai_assistant.sql` creates six tables for the AI Reply Assistant feature (`ai_policies`, `ai_providers`, `ai_phrase_library`, `ai_forbidden_terms`, `ai_reply_logs`, `contract_topology_paths`) and adds two ALTER TABLE statements: `devices.role ENUM('cpe','pop','backbone','border','access') NULL` for topology classification, and `network_links.medium ENUM('fiber','wireless','copper') NULL` + `network_links.role ENUM('backbone','distribution','access','client') NULL` for link metadata used by `topologyContextService`.

> **Migration 170 — AI cost roll-up columns on organization_quotas:** `170_ai_cost_rollup.sql` adds `max_ai_tokens_month BIGINT UNSIGNED NULL` (monthly token budget; NULL = unlimited), `ai_cost_month_usd DECIMAL(10,4) NOT NULL DEFAULT 0` (running cost accumulator reset monthly by the `aiCostRollupWorker`), and `ai_cost_rollup_month DATE NULL` (date of the last roll-up) to `organization_quotas`.

> **Migration 171 — AI RBAC permissions seed:** `171_seed_ai_permissions.sql` inserts the seven granular AI permission slugs (`ai.policy.read`, `ai.policy.write`, `ai.phrases.read`, `ai.phrases.write`, `ai.reply.draft`, `ai.reply.send`, `ai.providers.write`) into `permissions` and grants them to the `admin` role via `role_permissions`. Uses `INSERT IGNORE` for idempotent re-runs.

> **Migration 172 — `embedding_model` on ai_providers:** `172_add_embedding_model_to_ai_providers.sql` adds `embedding_model VARCHAR(120) NULL` to `ai_providers`. When populated and `VECTOR_RETRIEVAL_ENABLED=true`, the `vectorStoreService` uses this model via `llmProviderService.embed()` to generate embeddings for ChromaDB upserts and similarity queries in the RAG pipeline.

> **Migration 266 — FTTH OLT & ONU management tables (§7.1/§7.2):** `266_create_ftth_olt_onu_tables.sql` creates seven FTTH-specific tables: `olt_ports` (PON/uplink port inventory per OLT, with Tx/Rx optical power and ONU count), `onu_profiles` (service profile templates: T-CONT/GEM port/DBA/VLAN mapping), `onu_details` (per-ONU provisioning detail extending the `devices` row: SN, LOID/Password encrypted, state, ranging distance, profile assignment, WAN mode), `onu_optical_metrics` (per-ONU optical diagnostic time-series: Tx power, Rx power, temperature, voltage, bias current), `onu_whitelist` (MAC/SN allow-block list per OLT), `onu_omci_configs` (OMCI-style Wi-Fi SSID/password and WAN config records — delivery via OMCI/TR-069/SSH-CLI job layer), and `onu_firmware_jobs` (batch firmware upgrade and reboot scheduler: scoped to single ONU, PON port, or full OLT). OLTs and ONUs are existing device records (`type='olt'/'onu'`); these tables add GPON domain detail without a parallel device registry.

> **Migration 267 — FTTH vendor capability profiles + splitter inventory (§7.1):** `267_create_ftth_vendor_splitter_tables.sql` creates `olt_vendor_capabilities` (global per-vendor capability matrix mapping vendor/model to supported protocols, SNMP profile, CLI template names, NETCONF schema, OMCI flag, and enterprise OID root — seeds rows for Huawei MA5800/EA5800, ZTE C300/C320/C600, VSOL V1600, C-Data 1600/9000, WOLCK WNM, and Calix E7) and `olt_splitters` (PON splitter inventory: 1:2 through 1:128 ratios, linked to site and OLT port). Also adds the deferred `fk_onu_details_provision_job` FK on `onu_details.last_provision_job_id → onu_firmware_jobs` via guarded stored procedure.

> **Migration 268 — FTTH RBAC permissions seed (§7.1/§7.2):** `268_seed_ftth_permissions.sql` seeds 32 permissions covering `olt_management.*`, `olt_ports.*`, `olt_splitters.*`, `onu_management.*`, `onu_profiles.*`, `onu_whitelist.*`, `onu_omci_configs.*`, and `onu_firmware_jobs.*`. Role matrix: admin (all 32), technician (all *.view + onu_management.update + onu_whitelist.create + onu_omci_configs.create + onu_firmware_jobs.create = 12), readonly (*.view only = 8).

> **Migration 269 — FTTH scheduled task seeds (§7.1/§7.2):** `269_seed_ftth_scheduled_tasks.sql` seeds six global scheduled tasks: `ftth_olt_chassis_poll` (every 5 min, SNMP chassis metrics), `ftth_olt_port_metrics_poll` (every 5 min, PON port Tx/Rx/ONU count), `ftth_onu_discovery` (every 15 min, scan OLTs for new ONUs), `ftth_onu_optical_poll` (every 10 min, per-ONU optical diagnostics), `ftth_onu_firmware_job_processor` (every 1 min, dispatch pending firmware/reboot jobs), and `ftth_onu_optical_metrics_cleanup` (nightly, delete rows older than 90 days).

> **Migration 270 — PON Port Management enhancements (§7.3):** `270_pon_port_management.sql` extends `olt_ports` with 6 new columns via guarded stored procedures: `maintenance_mode` (TINYINT), `maintenance_note` (VARCHAR 255), `maintenance_by` / `maintenance_at` (audit trail), `xgspon_mode` (ENUM gpon/xgspon_2_5g/xgspon_10g/auto/none), `xgspon_mode_validated`. Creates `onu_migration_jobs` table (ONU transactional port reassignment records, RESTRICT deletes on port FKs, status lifecycle pending→queued→in_progress→completed/failed/cancelled).

> **Migration 271 — PON Port Management permissions (§7.3):** `271_seed_pon_port_permissions.sql` seeds 8 permissions: `olt_ports.shutdown`, `olt_ports.configure_mode`, `olt_ports.utilization`, `olt_ports.power_budget`, `onu_migration_jobs.view/create/update/delete`. Admin gets all 8; technician gets utilization/power_budget/shutdown/configure_mode + onu_migration_jobs.view/create; readonly gets utilization/power_budget + onu_migration_jobs.view.

> **Migration 272 — Fiber Plant Management tables (§7.4):** `272_fiber_plant_management.sql` creates 6 new tables: `fiber_routes` (CO→splitter→ONU path hierarchy with parent_route_id self-FK, GIS path JSON, from/to device/port/ONU/splitter FKs), `odf_frames` (ODF physical inventory per site), `odf_ports` (port records within a frame, UNIQUE on frame+port_number, CASCADE on frame delete), `odf_cross_connects` (patch cord records between two ODF ports, RESTRICT deletes), `otdr_test_results` (fault detection records with fault_type ENUM, events JSON, sor_file_path; live I/O = honest stub), `sfp_inventory` (SFP lifecycle: installed/spare/faulty/retired; links to devices and inventory_items; DDM diagnostics via existing snmp_metrics sfp_* columns from migration 255).

> **Migration 273 — Fiber Plant Management permissions (§7.4):** `273_seed_fiber_plant_permissions.sql` seeds 24 permissions covering `fiber_routes.*` (4), `odf_frames.*` (4), `odf_ports.*` (4), `odf_cross_connects.*` (4), `otdr_tests.*` (4), `sfp_inventory.*` (4). Admin gets all 24; technician gets all views + fiber_routes/odf/sfp create+update + otdr_tests.create (16 total); readonly gets all 6 *.view permissions.

> **Migration 274–276 — CPE Management & Profiles (§8.1/§8.2):** `274_cpe_devices_and_tasks.sql` creates `cpe_devices` (TR-069/CWMP CPE registry with HTTP Basic ACS auth, status machine new→provisioning→active/error/offline), `cpe_parameters` (parameter tree storage, UNIQUE on device+path), and `cpe_tasks` (CWMP task queue with 8 task_type values, priority 1–10). `275_cpe_profiles_and_firmware.sql` creates `cpe_profiles` (provisioning templates with self-referencing parent_profile_id for up to 5-level inheritance, plan auto-apply, WiFi/WAN config fields), `cpe_parameter_mappings` (static/contract/plan/device-field source rules), `cpe_firmware_versions` (manufacturer+model+version unique, checksum types), and `cpe_firmware_campaigns` (batch firmware push with device targeting by manufacturer/model/profile/ad-hoc IDs). `276_cpe_fk_permissions_seeds.sql` wires the deferred FK `fk_cpe_devices_cpe_profile` via INFORMATION_SCHEMA-guarded procedure, seeds 26 permissions across `cpe_management.*` (8) and `cpe_profiles.*` (6), grants admin all 26, and seeds 8 vendor default profiles (TP-Link, ZTE, Huawei, Fiberhome, VSOL, D-Link, Netis, Tenda).

> **Migration 277 — CPE Diagnostics & Session Logs (§8.3):** `277_cpe_diagnostics_and_session_logs.sql` creates `cpe_diagnostics` (ping/traceroute/wifi_snapshot/ethernet_status/wan_diagnostics result store with status machine pending→running→completed/failed, result JSON, target_host) and `cpe_session_logs` (CWMP event log for all inform/task/fault/auth events; raw_body truncated at 2000 chars). Extends `cpe_tasks.task_type` ENUM with ping_diagnostic/traceroute_diagnostic/wifi_diagnostics/wan_diagnostics via INFORMATION_SCHEMA-guarded stored procedure. Seeds 5 permissions (cpe_diagnostics.view/create/delete + cpe_session_logs.view/delete) and a nightly cleanup scheduled task (0 3 * * *, cleanup type, keeps 90 days).

> **Migration 278 — CPE Inventory Lifecycle (§8.4):** `278_cpe_inventory_lifecycle.sql` extends `cpe_devices` with lifecycle_state ENUM (in_stock/assigned/active/returned/rma), subscriber_id FK to clients, subscriber_linked_at timestamp, and depreciation fields (purchase_cost, purchase_date, depreciation_method straight_line/declining_balance, useful_life_months, salvage_value) via INFORMATION_SCHEMA-guarded ALTERs. Creates `cpe_lifecycle_history` (immutable FSM audit trail). Seeds 5 permissions (cpe_inventory.view/manage/swap/link + cpe_lifecycle_history.view).

> **Migrations 279–281 — WISP/Wireless Management (§9.1):** `279_wireless_ap_sector_tables.sql` creates 5 tables: `ap_channel_plans` (channel registry per site for frequency conflict avoidance), `ap_sector_configs` (RF configuration per AP sector device — azimuth/frequency/power/encryption), `wireless_client_sessions` (append-only CPE client state snapshots per AP poll), `ap_command_jobs` (remote AP command queue for power/frequency/reboot), `wireless_channel_interference` (RF interference records). Also adds wireless RF metric columns to `snmp_metrics` and `snmp_metrics_1month` (noise_floor_dbm, air_util_pct, gps_sync_status, snr_db, ccq_pct, tx/rx_rate_mbps) via stored-procedure guards. `280_wireless_vendor_oid_seeds.sql` adds SNMP profiles for Mimosa, Tarana, Radwin, Siklu and extends Ubiquiti/MikroTik profiles with RF OIDs. `281_seed_wireless_permissions.sql` seeds 15 permissions across 5 permission sets.

> **Migrations 282–283 — PTP/PTMP Links + Link Planning Calculator (§9.2):** `282_ptp_link_extensions.sql` adds 9 columns to `network_links` via INFORMATION_SCHEMA-guarded stored procedure (tx_signal_dbm, rx_signal_dbm, modulation, tx_throughput_mbps, rx_throughput_mbps, link_budget_db, failover_link_id, is_primary, failover_state); creates `link_planning_calcs` table for saved link budget calculator runs (haversine distance, FSPL, Fresnel zone radius, clearance, link budget). `283_seed_link_planning_permissions.sql` seeds 8 permissions: ptp_links.view/update, link_planning.view/create/update/delete, link_failover.view/manage.

> **Migrations 284–285 — RF Metrics + Spectrum Scans (§9.3):** `284_rf_spectrum_scan_tables.sql` creates `spectrum_scan_results` table (scan_type ENUM, frequency range, scan_data JSON array of {freq_mhz, power_dbm}, peak_interference_dbm, recommended_channel_mhz, status ENUM); adds GPS sync OIDs for Ubiquiti airOS (ubntAirIfGpsSync 1.3.6.1.4.1.41112.1.6.1.2.1.5) and Mimosa Networks (mimosaGpsSync 1.3.6.1.4.1.43356.2.1.2.1.1.8); seeds `wireless_ap_sector_poll` scheduled task (every 5 minutes, snmp_poll type). `285_seed_rf_metrics_permissions.sql` seeds 4 permissions: spectrum_scans.view/create/delete + rf_metrics.view.

### Venta al Público en General (Factura Pública)

Mexican tax law (SAT CFDI 4.0) requires every sale to be fiscally documented, even when the client does not request an individual factura. For MX-locale contracts where the client opts out of individual CFDIs, the ISP uses the **"venta al público en general"** mechanism:

1. **Per-contract `facturar` flag:** Each contract has a `facturar` BOOLEAN column (default `FALSE`). Set to `TRUE` when the client wants an individual CFDI for that contract's invoices, `FALSE` when they do not. The same client can have some contracts with `facturar = TRUE` and others with `facturar = FALSE`.

2. **Client MX profile requirement:** If ANY of a client's contracts has `facturar = TRUE`, the client MUST have a `client_mx_profiles` row with valid SAT data (RFC, razon_social, regimen_fiscal, codigo_postal_fiscal). This is enforced at the application layer. If ALL contracts have `facturar = FALSE`, the profile is optional.

3. **RFC uniqueness:** A stored generated column (`rfc_unique_check`) evaluates to `NULL` for `XAXX010101000` and to the actual RFC otherwise. The UNIQUE constraint on this column allows multiple público-en-general profiles while still enforcing uniqueness for real RFCs.

4. **Normal invoicing continues:** Invoices are still created for `facturar = FALSE` contracts (for internal billing, collection, and payment tracking), but no individual CFDI is stamped for them.

5. **Periodic factura pública aggregation:** All invoices from `facturar = FALSE` contracts are aggregated into a periodic factura pública document (`factura_publica_invoices`) per the SAT `InformacionGlobal` node requirements:
   - **Periodicidad** (`c_Periodicidad`): `01`=Diario, `02`=Semanal, `03`=Quincenal, `04`=Mensual, `05`=Bimestral
   - **Meses** (`c_Meses`): `01`–`12` individual months; `13`–`18` bimonthly periods
   - **Año**: Fiscal year

6. **Invoice-to-factura-pública linking:** The `factura_publica_invoice_items` junction table links each invoice to its parent factura pública. Each invoice can belong to at most one factura pública (enforced by UNIQUE constraint on `invoice_id`).

7. **Factura pública receptor data:** When the factura pública is stamped, the `cfdi_documents` receptor snapshot uses: RFC `XAXX010101000`, Nombre `PUBLICO EN GENERAL`, RegimenFiscal `616` (Sin obligaciones fiscales), UsoCFDI `S01` (Sin efectos fiscales).

8. **Predominant FormaPago calculation (migration 091):** Every CFDI 4.0 requires exactly one `FormaPago` code. When a factura pública aggregates invoices paid via different methods, call `fn_predominant_forma_pago(factura_publica_invoice_id)` at stamp time to obtain the correct code. The function sums `payments.amount` grouped by `sat_forma_pago` and returns the code with the highest total. If two or more codes tie, or if no payments are recorded, it returns `'99'` (Por definir) per SAT Anexo 20 rules.

9. **Unpaid invoice exclusion (migration 091):** Only invoices with `status = 'paid'` may be included in a stamped factura pública. This is enforced by two database-level safeguards: a BEFORE INSERT trigger on `factura_publica_invoice_items` rejects linking any invoice that is not yet paid, and a BEFORE UPDATE trigger on `factura_publica_invoices` blocks transitioning `status` to `'stamped'` if any linked invoice is not paid. Both raise SQLSTATE '45000' on violation. This prevents the ISP from paying taxes on revenue it has not yet collected.

> **This feature only applies to MX-locale clients.** The existing locale enforcement triggers (migration 087) prevent CFDI documents from being created for non-MX clients. Non-MX clients are not affected by the `facturar` flag.

### Storage Folders

The `storage/` directory holds user-uploaded and system-generated files organized by entity type. The `files` database table stores metadata and paths for every stored file.

| Folder | Entity Type | File Categories |
|--------|-------------|-----------------|
| `storage/devices/` | Devices | device_history, evidence |
| `storage/clients/` | Clients | client_file, notification_log |
| `storage/tickets/` | Tickets | chat_history, document |
| `storage/organizations/` | Organizations | isp_info, sat, online_payment, map, logo |
| `storage/backups/` | System | backup |

## Getting Started

### Connection Types

Each contract specifies a `connection_type` that determines how the client connects and whether RADIUS is required:

| Connection Type | Description | RADIUS Required | IP Management |
|-----------------|-------------|-----------------|---------------|
| `pppoe` (default) | PPPoE session — IPv4 only via RADIUS | Yes — create a `radius` record linked to the contract | `radius.ip_address` (static) or `radius.ipv4_pool_id` pool-assigned (dynamic) |
| `pppoe_dual` | PPPoE session — dual-stack IPv4 + IPv6 via RADIUS | Yes — create a `radius` record with IPv4 and IPv6 fields | `radius.ip_address` + `radius.ipv6_address` / `radius.ipv6_delegated_prefix` (static) or pool-assigned via `radius.ipv4_pool_id` + `radius.ipv6_pool_id` (dynamic) |
| `static` | Static IPv4 — IP assigned directly, no PPPoE | No | `ip_assignments` row linked to the contract via `contract_id` |
| `dual` | Dual-stack static IPv4 + IPv6 — no PPPoE | No | One IPv4 + one IPv6 `ip_assignments` row, both linked to the contract |

### IPv4 / IPv6 / Dual-Stack Support

The schema is ready for IPv4-only, IPv6-only, and dual-stack deployments:

| Table | IPv4 | IPv6 | Dual-Stack Notes |
|-------|------|------|------------------|
| `ip_pools` | `ip_version = '4'` | `ip_version = '6'` | Create separate pools per address family; link both to the same site |
| `ip_assignments` | Single address (`prefix_len` = NULL) | Address or prefix (`prefix_len` = 48, 56, 64, …) | One row per address/prefix; a dual-stack subscriber gets one v4 + one v6 assignment |
| `radius` | `ip_address` (static) or `ipv4_pool_id` (dynamic) | `ipv6_address` + `ipv6_delegated_prefix` / `ipv6_prefix_len` (static) or `ipv6_pool_id` (dynamic) | All IPv6 fields coexist with IPv4 for seamless dual-stack PPPoE sessions; `nas_id` links the subscriber to its NAS |
| `nas` | `ip_address` | `ipv6_address` | Both addresses stored per NAS for dual-stack management |
| `devices` | `ip_address` | `ipv6_address` | Both addresses stored per device for dual-stack management |

### SNMP Monitoring

The `devices` table includes SNMP configuration columns (`snmp_enabled`, `snmp_community`, `snmp_version`, `snmp_port`) so that both **client CPE** and **POP infrastructure** devices can be polled. Collected metrics are stored in a three-tier structure for efficient querying and long-term retention:

| Data Tier | Resolution | Retention | Description |
|-----------|------------|-----------|-------------|
| `snmp_metrics` (raw) | 5-min polls | 90 days | Wide table — one row per device/interface per poll (8× fewer rows than narrow EAV); monthly partitions enable instant `DROP PARTITION` retention |
| `snmp_metrics_1hr` | Hourly averages | 1 year | Wide table — per-metric `avg_*` / `min_*` / `max_*` columns; idempotent rollup via `INSERT … ON DUPLICATE KEY UPDATE` |
| `snmp_metrics_1day` | Daily averages | 3+ years | Wide table — aggregated from `snmp_metrics_1hr`; kept indefinitely |

#### Supported SNMP Metrics

Each raw poll row stores up to eight metrics as individual columns:

| Column | Type | Description |
|--------|------|-------------|
| `if_in_octets` | `BIGINT` | ifInOctets — bytes received |
| `if_out_octets` | `BIGINT` | ifOutOctets — bytes transmitted |
| `if_in_errors` | `BIGINT` | ifInErrors — inbound error count |
| `if_out_errors` | `BIGINT` | ifOutErrors — outbound error count |
| `cpu_usage` | `SMALLINT` | CPU utilization percentage |
| `memory_usage` | `SMALLINT` | Memory utilization percentage |
| `signal_strength` | `INTEGER` | Wireless signal strength in dBm |
| `latency_ms` | `DECIMAL(10,2)` | ICMP ping latency in milliseconds |

The optional `interface_id` column stores the SNMP `ifIndex` or `ifDescr` for interface-level metrics (e.g., multiple interfaces on a router or switch).

#### Scale Targets

| Metric | Value |
|--------|-------|
| Devices | 6,000 |
| Poll interval | 5 minutes |
| Rows per day (raw) | ~1.73 million |
| Raw retention | 90 days (~155 million rows) |
| Raw table design | Wide — no FK, no per-row OID, monthly partitions |

#### Automated Rollup & Retention (MySQL Event Scheduler)

Data aggregation and retention are handled by MySQL stored procedures and scheduled events — the MySQL equivalent of TimescaleDB continuous aggregates and retention policies. The MySQL Event Scheduler must be enabled:

```sql
SET GLOBAL event_scheduler = ON;
```

Or in `my.cnf` / `my.ini`:

```ini
[mysqld]
event_scheduler = ON
```

> **⚠️ Prerequisite:** `event_scheduler = ON` is **required** for automated SNMP rollup/retention and `connection_logs` partition maintenance. If it is disabled, SNMP aggregation stops, old partitions accumulate past their retention windows, and `connection_logs` inserts will eventually fail when `p_future` is exhausted. Run the preflight check procedure (see [Preflight Check](#preflight-check-event-scheduler)) during deployment to detect this early.

| Event | Schedule | Action |
|-------|----------|--------|
| `evt_snmp_rollup_1hr` | Every hour at :05 | Calls `snmp_rollup_to_1hr()` — aggregates raw → hourly using high-watermark |
| `evt_snmp_rollup_1day` | Daily at 00:30 | Calls `snmp_rollup_to_1day()` — aggregates hourly → daily using high-watermark |
| `evt_snmp_retention` | Daily at 02:00 | Calls `snmp_apply_retention()` — purges hourly data older than 1 year |
| `evt_snmp_partition_maintenance` | Daily at 03:00 | Calls `snmp_maintain_partitions()` — adds future month partitions and drops expired ones (replaces batch DELETE for raw data retention) |

All rollup procedures use a **high-watermark** (`snmp_rollup_state` table) to track the last successfully processed timestamp, so missed runs catch up automatically rather than only looking back a fixed window. Rollup procedures use `INSERT … ON DUPLICATE KEY UPDATE` for idempotent re-runs. Raw data retention is instant (partition `DROP`) while hourly retention uses batch deletes (10 000 rows per iteration) since that table is much smaller.

### Connection Logs (Compliance & Usage)

The `connection_logs` table records every RADIUS accounting event (`start`, `stop`, `interim-update`) per contract, providing a complete audit trail of subscriber sessions for regulatory compliance. Each row is **self-contained** — it captures the subscriber identity, assigned IP address(es), NAS, and session counters at the time of the event, so the record remains valid even if the contract or client is later deleted.

| Column | Description |
|--------|-------------|
| `contract_id` / `client_id` | Contract and client at time of session (no FK — compliance) |
| `username` | RADIUS username at time of session |
| `session_id` | RADIUS Acct-Session-Id |
| `ip_address` / `ipv6_address` / `ipv6_delegated_prefix` | IP address(es) assigned during the session |
| `nas_id` / `nas_ip_address` | NAS that authenticated the session |
| `event_type` | `start`, `stop`, or `interim-update` |
| `bytes_in` / `bytes_out` / `packets_in` / `packets_out` | Session traffic counters (at stop/interim) |
| `session_duration` | Duration in seconds (at stop) |
| `terminate_cause` | RADIUS Acct-Terminate-Cause (at stop) |

**Retention:** 2 years via monthly partition `DROP`, managed by `connection_logs_maintain_partitions()`.

> **⚠️ Requires `event_scheduler = ON`:** The scheduled event below will not run if the MySQL Event Scheduler is disabled. Without it, future partitions are never created (causing inserts to fail) and expired partitions are never dropped (violating the 2-year compliance retention window). See [Preflight Check](#preflight-check-event-scheduler) to validate this at deployment time.

| Event | Schedule | Action |
|-------|----------|--------|
| `evt_connection_logs_partition_maintenance` | Daily at 03:30 | Calls `connection_logs_maintain_partitions()` — adds future month partitions and drops expired ones (2-year retention) |

**Typical queries:**

```sql
-- Who had IP 10.0.1.42 on 2026-03-15?
SELECT * FROM connection_logs
WHERE ip_address = '10.0.1.42'
  AND event_at >= '2026-03-15' AND event_at < '2026-03-16';

-- All sessions for contract #123 in March 2026
SELECT * FROM connection_logs
WHERE contract_id = 123
  AND event_at >= '2026-03-01' AND event_at < '2026-04-01';

-- Total data usage per contract for billing period
SELECT contract_id,
       SUM(bytes_in)  AS total_download,
       SUM(bytes_out) AS total_upload
FROM connection_logs
WHERE event_type IN ('stop', 'interim-update')
  AND event_at >= '2026-03-01' AND event_at < '2026-04-01'
GROUP BY contract_id;
```

### Preflight Check: Event Scheduler

Migration `053` creates a `preflight_check_event_scheduler()` stored procedure that validates the MySQL Event Scheduler is enabled. Call it during deployment or application startup:

```sql
CALL preflight_check_event_scheduler();
```

If `event_scheduler` is **not** `ON`, the procedure raises a `SQLSTATE '45000'` error with a descriptive message explaining the risk and how to fix it. It returns silently when the scheduler is correctly enabled.

**Why this matters:**

| Consequence | Detail |
|-------------|--------|
| `connection_logs` insert failures | Without daily partition maintenance, `p_future` fills up and INSERTs start failing |
| Compliance retention violation | Partitions older than 2 years are never dropped, accumulating data beyond the regulatory window |
| SNMP data gap | Rollup and retention events stop running, leaving raw data unbounded |

**To enable the Event Scheduler:**

```sql
-- At runtime (resets on MySQL restart unless also set in my.cnf):
SET GLOBAL event_scheduler = ON;
```

```ini
# In my.cnf / my.ini (persistent across restarts):
[mysqld]
event_scheduler = ON
```

### SNMP OID Profile System

The SNMP OID profile system lets you customize which OIDs are polled for each device brand and model without changing any application code — just insert new rows into the profile tables.

#### How Profiles Work

Each `snmp_profiles` row is a named polling template that the poller selects for a device. Once a profile is selected, the poller walks every OID listed in `snmp_profile_oids` for that profile and stores each result in the corresponding `snmp_metrics` wide-table column (`metric_column`).

#### Profile Resolution Order

For every device where `snmp_enabled = TRUE`, the poller resolves its profile as follows:

1. **Explicit override** — if `devices.snmp_profile_id IS NOT NULL`, use that profile directly.
2. **Auto-match** — otherwise query `snmp_profiles` for the best match:
   ```sql
   SELECT * FROM snmp_profiles
   WHERE (manufacturer  = device.manufacturer  OR manufacturer  IS NULL)
     AND (device.model LIKE model_pattern       OR model_pattern IS NULL)
     AND (device_type   = device.type           OR device_type   IS NULL)
     AND status = 'active'
   ORDER BY manufacturer DESC, model_pattern DESC, device_type DESC
   LIMIT 1;
   ```
   More-specific matches (manufacturer + model_pattern + device_type) rank higher than wildcard rows.
3. **Default fallback** — if no profile matches, select the profile with `is_default = TRUE` and `status = 'active'`.
4. **Walk OIDs** — fetch all `snmp_profile_oids` rows for the resolved profile and poll each OID, storing results into `snmp_metrics` using the `metric_column` mapping.

#### Pre-Seeded Profiles

| Profile | `manufacturer` | Key Vendor OIDs |
|---------|---------------|-----------------|
| **Generic IF-MIB** *(default)* | `NULL` (any) | Standard IF-MIB (RFC 2863) interface counters + HOST-RESOURCES-MIB CPU/memory |
| **Ubiquiti airOS** | `Ubiquiti` | Enterprise `1.3.6.1.4.1.41112.*` OIDs for signal strength, CPU, memory |
| **MikroTik RouterOS** | `MikroTik` | Enterprise `1.3.6.1.4.1.14988.*` OID for wireless signal + HOST-RESOURCES-MIB |
| **Cambium Networks** | `Cambium` | Enterprise `1.3.6.1.4.1.161.*` OIDs for RSSI and CPU |

#### Adding a New Vendor Profile

To add a new brand or model without touching any code:

```sql
-- 1. Create the profile
INSERT INTO snmp_profiles (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, description)
VALUES ('Huawei OLT', 'Huawei', NULL, 'olt', 'v2c', 300, 'Huawei OLT devices — MA5800 series');

-- 2. Map the OIDs
INSERT INTO snmp_profile_oids (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
VALUES
    (LAST_INSERT_ID(), '1.3.6.1.2.1.2.2.1.10', 'if_in_octets',  'Inbound Octets',  'counter', TRUE,  10),
    (LAST_INSERT_ID(), '1.3.6.1.2.1.2.2.1.16', 'if_out_octets', 'Outbound Octets', 'counter', TRUE,  20),
    (LAST_INSERT_ID(), '1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4', 'cpu_usage', 'Huawei CPU (%)', 'gauge', FALSE, 30);
```

The next poll cycle will automatically use the new profile for all Huawei OLT devices.

### Inventory / Warehouse

The inventory system tracks spare equipment and materials across multiple physical warehouses. Each warehouse can define granular storage locations using **aisle**, **column**, and **shelf** identifiers. Items move through the system via an immutable transaction log, supporting the full lifecycle from purchase to deployment or sale.

#### Tables Overview

| Table | Purpose |
|-------|---------|
| `warehouses` | Physical storage locations (multiple warehouses supported) |
| `inventory_items` | Product catalog — each row is a type of spare part or material |
| `inventory_stock` | Current quantity on hand per item per warehouse location (aisle/column/shelf) |
| `inventory_transactions` | Immutable movement log — every receive, assignment, sale, transfer, return, or adjustment |

#### Transaction Types

| Type | Direction | Description |
|------|-----------|-------------|
| `receive` | Inbound (+) | New stock received from a supplier |
| `assign_to_job` | Outbound (−) | Item used on a field work order (`work_orders`) |
| `sell_to_client` | Outbound (−) | Item sold directly to a client (optionally linked to an invoice) |
| `transfer_out` | Outbound (−) | Item sent to another warehouse location |
| `transfer_in` | Inbound (+) | Item received from another warehouse location |
| `return` | Inbound (+) | Item returned from a job or client |
| `adjustment` | +/− | Manual stock correction (shrinkage, recount, etc.) |

#### Item Categories

`antenna`, `cable`, `router`, `switch`, `onu`, `olt`, `cpe`, `connector`, `power_supply`, `enclosure`, `tool`, `other`

#### Typical Queries

```sql
-- Current stock for all items across all warehouses
SELECT ii.name, w.name AS warehouse, s.aisle, s.col, s.shelf, s.quantity
FROM inventory_stock s
JOIN inventory_items ii ON ii.id = s.item_id
JOIN warehouses w ON w.id = s.warehouse_id
ORDER BY ii.name, w.name;

-- Items below reorder level
SELECT ii.name, ii.reorder_level, SUM(s.quantity) AS total_on_hand
FROM inventory_items ii
JOIN inventory_stock s ON s.item_id = ii.id
WHERE ii.reorder_level IS NOT NULL AND ii.status = 'active'
GROUP BY ii.id
HAVING total_on_hand < ii.reorder_level;

-- All transactions for a specific job
SELECT it.*, ii.name AS item_name
FROM inventory_transactions it
JOIN inventory_stock s ON s.id = it.stock_id
JOIN inventory_items ii ON ii.id = s.item_id
WHERE it.job_id = 42;

-- Revenue from inventory sales in March 2026
SELECT ii.name, SUM(ABS(it.quantity)) AS units_sold,
       SUM(ABS(it.quantity) * it.unit_price) AS revenue
FROM inventory_transactions it
JOIN inventory_stock s ON s.id = it.stock_id
JOIN inventory_items ii ON ii.id = s.item_id
WHERE it.transaction_type = 'sell_to_client'
  AND it.created_at >= '2026-03-01' AND it.created_at < '2026-04-01'
GROUP BY ii.id;
```

See the [`docs/`](docs/) directory for detailed guides on [API usage](docs/API_GUIDE.md), [architecture](docs/architecture.md), [deployment](docs/deployment.md) (includes Helm chart + Argo CD GitOps), [RADIUS setup](docs/radius-setup.md), [backup & restore](docs/backup-restore.md), [volume persistence](docs/volume-persistence.md), [RBAC permissions](docs/rbac-permissions.md), [webhook events](docs/webhook-events.md), [FireRelay clustering](docs/firerelay.md), [tenant database isolation](docs/tenant-database-isolation.md), [TLS setup](docs/tls-setup.md), [load testing](docs/load-testing.md), [SLOs & alerting](docs/slo.md), [pen-test guide](docs/pentest.md), [privacy & DSAR](docs/privacy.md), [secrets management](docs/secrets-management.md), [DR drill](docs/dr-drill.md), the [operational runbook](docs/runbook.md), and [video walkthroughs](docs/videos/) for data migration and FireRelay installation.

## Getting Started (from Source)

```bash
# 1. Clone the repository
git clone https://github.com/vothalvino/fireisp5.0.git
cd fireisp5.0

# 2. Enable the expected package manager
corepack enable
corepack prepare pnpm@10.33.2 --activate

# 3. Install workspace dependencies
pnpm install

# 4. Configure environment
cp .env.example .env
# Edit .env — set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET, and ENCRYPTION_KEY

# 5. Set up the database (MySQL 8.0+ / MariaDB 10.6+)
pnpm run migrate
pnpm run seed

# 6. Start the backend API
pnpm run dev

# 7. In another terminal, start the frontend
pnpm --filter fireisp-frontend dev
```

- Frontend dev UI: `http://localhost:5173`
- Backend API: `http://localhost:3000/api/v1/`
- Interactive API docs: `http://localhost:3000/api/docs`
- Health endpoints: `http://localhost:3000/health/live` and `http://localhost:3000/health/ready`

### Docker Quick Start

```bash
cp .env.example .env
# Edit .env as above
docker compose up -d
```

### Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start with auto-reload (nodemon) |
| `pnpm --filter fireisp-frontend dev` | Start the Vite frontend on port 5173 |
| `pnpm start` | Production start |
| `pnpm test` | Run test suite (Jest) |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:db` | Run database-level SQL tests (triggers, constraints, referential integrity) |
| `pnpm run lint` | Lint source code (ESLint) |
| `pnpm run lint:fix` | Lint and auto-fix source code |
| `pnpm run migrate` | Apply pending database migrations |
| `MIGRATE_ISOLATED_TENANTS=true pnpm run migrate` | Apply pending migrations to all isolated tenant databases after the primary migration succeeds |
| `pnpm run seed` | Seed default data (roles, settings, tax rates) |
| `pnpm run openapi` | Generate OpenAPI spec to `docs/openapi.json` |
| `pnpm run spec:check` | Check for OpenAPI ↔ route drift (run in CI) |
| `pnpm run sql:check` | Check every `INSERT`/`UPDATE` in `src/` against `database/schema.sql` — column names and ENUM values (run in CI) |
| `pnpm run schema:parity` | Offline `schema.sql` ↔ migrations parity check (no database needed; run in CI) |
| `pnpm run spec:gen` | Scaffold a new route stub from the OpenAPI spec |
| `pnpm --filter fireisp-frontend test` | Run frontend tests (Vitest) |
| `pnpm --filter fireisp-frontend run lint` | Run frontend type-check / lint step |
| `pnpm --filter fireisp-frontend build` | Build the frontend bundle |
| `pnpm --filter fireisp-e2e test` | Run Playwright smoke tests |
| `pnpm run admin -- create-user --email admin@example.com --password secret --role admin` | Create admin user |
| `pnpm run backup` | Back up the database |

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) for coding standards, branch naming, commit message conventions, and the database migration checklist before submitting a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.




