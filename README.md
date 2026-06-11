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
- RESTful API with 286 endpoints, interactive Swagger UI documentation (`/api/docs`), and static OpenAPI spec (`docs/openapi.json`)
- GraphQL gateway (`/api/v1/graphql`) powered by graphql-yoga v5 — single-request multi-entity fetches, real-time subscriptions via SSE (PubSub), and a live ClientDetail query replacing multiple REST round-trips
- Real-time event hub (WebSocket + SSE dual-broadcast) — live Dashboard device-status indicator, live TicketDetail comment stream, and a useWebSocket React hook for all frontend consumers
- httpOnly SameSite=Strict cookie authentication — access token in memory, refresh token in httpOnly cookie, Origin-based CSRF guard; eliminates localStorage token exposure
- Dark mode — CSS custom-property token system, per-user preference persisted in localStorage, toggle in Layout and PortalLayout
- PROFECO complaint management — complaint register for ISPs subject to CONCILIANET obligations: intake, lifecycle tracking, staff attribution, quarterly export for regulatory filing
- Spec-driven development — `spec:check` drift scanner detects route/schema gaps against the OpenAPI spec in CI; `spec:gen` scaffolds new route stubs from the spec
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
│   ├── schema.sql           # Combined schema (all 173 tables + column additions)
│   └── migrations/          # Individual numbered migration files (001–248)
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
| 14 | `jobs` | Field work orders (installations, maintenance, repairs) |
| 15 | `expenses` | Operational expenses, optionally linked to jobs |
| 16 | `organizations` | ISP company / tenant configuration |
| 17 | `files` | File metadata for entity-scoped storage (devices, clients, tickets, organizations, backups) |
| 18 | `ip_pools` | IP address pools for subscriber assignment (IPAM) — supports both IPv4 and IPv6 pools |
| 19 | `ip_assignments` | Individual IP / prefix assignments to clients and devices (IPv4 single-address or IPv6 prefix delegation) |
| 20 | `audit_logs` | System-wide audit trail (who changed what and when) |
| 21 | `notifications` | User notifications and alerts (billing, network, tickets) |
| 22 | `invoice_items` | Individual line items that make up an invoice's subtotal |
| 23 | `quote_items` | Individual line items that make up a quote's subtotal |
| 24 | `ticket_comments` | Conversation tracking and internal notes on support tickets |
| 25 | `snmp_metrics` | Raw SNMP poll data (5-min intervals, 90-day retention) — wide table, one row per device/interface per poll, partitioned by month |
| 26 | `snmp_metrics_1hr` | Hourly SNMP metric aggregates (avg/min/max per metric column, 1-year retention) |
| 27 | `snmp_metrics_1day` | Daily SNMP metric aggregates (avg/min/max per metric column, 3+ year retention) |
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
| 127 | `service_orders` | Service order workflow — `order_number`, optional `client_id`/`lead_id`/`plan_id`/`contract_id`, `order_type`, status machine (`requested`→`approved`→`provisioning`→`activated`, or `cancelled`), assignment, and lifecycle timestamps |
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

> **Migration 165–173 table count note:** See migrations 241–246 below for the §5 Dual Stack tables.

> **Migration 241 — DHCP Server Integration (§5.1):** `241_create_dhcp_integration.sql` creates `dhcp_servers` (DHCP server registry supporting ISC Kea and MikroTik) and `dhcp_static_reservations` (MAC-to-IP bindings with DHCP Option 82 circuit/remote-id for subscriber identification). Foreign keys to `ip_pools`, `clients`, and `contracts` allow reservations to be linked to ISP provisioning data.

> **Migration 242 — NAT/CGNAT and PTR Records (§5.1):** `242_create_nat_ptr_management.sql` creates `nat_pools` (CGNAT/1:1 NAT/PAT pool definitions with external IP ranges and per-subscriber port limits) and `ptr_records` (reverse DNS PTR record management for both IPv4 and IPv6 with configurable TTL and zone).

> **Migration 243 — IPv6 Management Enhancements (§5.2):** `243_ipv6_management_enhancements.sql` adds 7 columns to `ip_pools` (DHCPv6 mode, Router Advertisement flags and lifetime, SLAAC prefix, region name) and `stack_type` to `plans` via stored-procedure guards. Creates `ra_guard_policies` table for per-port RA Guard policy management linked to devices.

> **Migration 244 — Dual-Stack Session Management (§5.3):** `244_dual_stack_session_management.sql` adds IPv6CP/DHCPv6-PD fields to `pppoe_service_profiles` (ipv6cp_enabled, delegated_prefix_len, DNS64), IPv6 RADIUS attributes to `radius` (Framed-IPv6-Address, Delegated-IPv6-Prefix, Framed-IPv6-Pool), and per-session IPv6 accounting fields to `connection_logs` (framed_ipv6_prefix, IPv6 octet counters, stack_type). All via stored-procedure guards; `connection_logs` uses no FK (partitioned table).

> **Migration 245 — IPv6 Transition Mechanisms (§5.4):** `245_create_transition_mechanisms.sql` creates four tables: `tunnel_6rd_configs` (6rd Border Relay + IPv6 prefix), `ds_lite_configs` (DS-Lite AFTR address), `map_rules` (MAP-E/MAP-T rule definitions with EA-bits), and `xlat464_configs` (464XLAT PLAT/CLAT/DNS64 prefixes). Together these support the four major IPv4-to-IPv6 transition mechanisms.

> **Migration 246 — Dual-Stack Permissions Seed (§5):** `246_seed_dual_stack_permissions.sql` seeds 25 permissions (`dhcp_servers.*`, `dhcp_reservations.*`, `nat_pools.*`, `ptr_records.*`, `ra_guard.*`, `transition_mechanisms.*`, `ipv6.management`) and assigns them to roles: admin (all 25), technician (all view permissions + ipv6.management), readonly (view permissions only).

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

> **Migrations 193–194 — Customer lifecycle (§1.2):** `193_create_customer_lifecycle_tables.sql` adds the `leads`, `service_orders`, `service_order_tasks`, and `winback_campaigns` tables. `194_seed_lifecycle_permissions.sql` seeds the `lifecycle` RBAC module permissions (`leads.*`, `service_orders.*`, `winback.*`, `lifecycle.view`) and assigns them to the default roles. New endpoints: full CRUD under `/leads` (plus `GET /leads/pipeline`, `POST /leads/:id/convert`), `/service-orders` (plus `POST /service-orders/:id/{approve,provision,activate,cancel}` and `GET/POST/PATCH /service-orders/:id/tasks`), `/winback-campaigns` (plus `GET /winback-campaigns/:id/targets`), and lifecycle analytics under `/lifecycle/churn` and `/lifecycle/at-risk`. Activating a service order emits `service_order.activated`, which sends a welcome email/SMS.

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
| `assign_to_job` | Outbound (−) | Item used on a field work order (`jobs`) |
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
