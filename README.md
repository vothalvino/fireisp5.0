# FireISP 5.0

An open source ISP (Internet Service Provider) management software designed to help ISPs manage their customers, plans, billing, and network infrastructure.

## Features

- Customer management
- Service plan management
- Billing, invoicing, and credit notes with multi-currency support (ISO 4217)
- Network device monitoring with SNMP metrics collection
- Connection logging for regulatory compliance and per-contract data usage (RADIUS accounting)
- Inventory and warehouse management — track spare equipment across multiple storage locations
- User and role management with RBAC (roles, permissions, role_permissions) — default roles and permissions seeded on install
- IP address management (IPAM) with IPv4, IPv6, and dual-stack support
- Audit logging and notifications
- Email / SMS / WhatsApp send log for auditing and billing disputes
- Service outage tracking with SLA reporting hooks
- Scheduled task observability and active session management — five core automation tasks seeded on install (auto-invoice, auto-suspend, RADIUS sync, revenue summary, network health snapshots)
- Default application settings seeded on install (currency, SMTP, SNMP, security, automation flags)
- Default tax rates seeded on install (Tax Exempt, Standard 8 %, IVA 16 % MX, GST 5 % CA)
- Payment allocation, inventory stock, and PPPoE RADIUS consistency enforced at the database level via guard triggers

## Project Structure

```
fireisp5.0/
├── database/                # Database schema and migrations
│   ├── schema.sql           # Combined schema (all tables)
│   └── migrations/          # Individual numbered migration files
├── src/                     # Application source code
│   ├── config/              # App configuration and environment settings
│   ├── controllers/         # Request handlers / route controllers
│   ├── middleware/           # Authentication, logging, and request middleware
│   ├── models/              # Data models / ORM entities
│   ├── routes/              # Route definitions
│   ├── services/            # Business logic layer
│   ├── utils/               # Shared helper functions
│   └── views/               # UI templates and frontend assets
├── storage/                 # User-uploaded and system-generated files
│   ├── devices/             # Per-device files (history, evidence)
│   ├── clients/             # Per-client files (documents, notification logs)
│   ├── tickets/             # Per-ticket files (chat history, attachments)
│   ├── organizations/       # Organization-level files (logos, maps, SAT docs)
│   └── backups/             # System database and config backups
├── docs/                    # Project documentation
├── public/                  # Public web assets (CSS, JS, images)
├── tests/                   # Automated tests
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
| 31 | `connection_logs` | Subscriber session events (start/stop/interim-update) for regulatory compliance and per-contract data usage — partitioned by month, 2-year retention |
| 32 | `warehouses` | Physical storage locations for spare equipment and materials (multiple warehouses supported) |
| 33 | `inventory_items` | Catalog of spare equipment and materials (antennas, cables, routers, ONUs, etc.) |
| 34 | `inventory_stock` | Current stock levels per item per warehouse location (aisle / column / shelf) |
| 35 | `inventory_transactions` | Immutable log of every stock movement — receiving, job assignments, client sales, transfers, returns, and adjustments |
| 36 | `credit_notes` | Credit notes issued to clients — for returns, courtesy, service outages, billing errors, duplicate payments, downgrades, cancellations, etc. |
| 37 | `credit_note_items` | Individual line items that make up a credit note's subtotal |
| 38 | `payment_allocations` | Junction table for split payments — records what portion of a payment was applied to each invoice (supports one-payment-many-invoices) |
| 39 | `billing_periods` | Tracks each contract's billing windows — which periods have been invoiced, which are upcoming, and when the next invoice should be auto-generated |
| 40 | `network_links` | Device-to-device connections — fiber, wireless, copper, or virtual links with capacity and interface metadata |
| 41 | `settings` | App settings / key-value configuration store — system-wide settings such as default tax rate, currency, invoice prefix, SMTP config, and SNMP poll interval |
| 42 | `tax_rules` | Tax rules per region and service type — supports VAT, sales tax, GST, and other regional tax configurations for multi-country ISPs |
| 43 | `client_balance_ledger` | Running account balance per client (prepaid / postpaid tracking) — records every debit (invoice, usage deduction) and credit (payment, top-up, credit note, adjustment) with a running balance; supports prepaid (credit remaining) and postpaid (amount owed) billing models |
| 44 | `email_logs` | Email / SMS / WhatsApp send log — records every message sent to clients or internal users with delivery status (queued, sent, delivered, failed, bounced) |
| 45 | `scheduled_tasks` | App-level task queue — dispatches recurring and one-shot jobs (auto-suspend overdue clients, generate invoices, RADIUS sync, SNMP polls) with cron scheduling, distributed locking, retry logic, priority ordering, and JSON payloads |
| 46 | `user_sessions` | Active session tracking for security audit — stores hashed session tokens, IP address, user-agent, and expiry; enables "logout all devices" and suspicious-login detection |
| 47 | `roles` | RBAC role definitions — named roles with optional system-role flag (system roles cannot be deleted) |
| 48 | `permissions` | RBAC permission definitions — granular permission slugs (e.g. `clients.view`, `invoices.create`) grouped by functional module |
| 49 | `role_permissions` | RBAC junction table — maps roles to their granted permissions (many-to-many) |
| 50 | `outages` | Planned and unplanned outage log — tracks network-wide events affecting many clients at once, per site and/or device with start/end times, severity, affected client count, root cause, and resolution status |
| 51 | `schema_migrations` | Migration state tracking — records which migration files have been applied so the deploy script can skip already-run files |
| 52 | `vlans` | VLAN registry linked to sites — tracks IEEE 802.1Q VLAN IDs per site for network segmentation, service isolation, and capacity planning |
| 53 | `tax_rates` | Named tax configurations (e.g. "IVA 16%", "Exempt", "GST 5%") — master table of reusable tax rates referenced by invoices, quotes, and credit notes |
| 54 | `message_templates` | Reusable message templates for email, SMS, and WhatsApp — stores subject, body, and placeholder variables for outbound communications (invoice reminders, welcome messages, outage alerts) |
| 55 | `api_tokens` | API keys for external integrations — hashed token secrets with optional scopes, expiry, revocation, and last-used tracking for third-party billing, monitoring tools, and custom integrations |
| 56 | `promotions` | Coupon codes, promotional pricing, and referral discounts — supports percentage and fixed-amount discounts with optional coupon codes, validity windows, per-client usage limits, and minimum order thresholds |
| 57 | `service_areas` | Geographic service areas (regions / markets) for sales territory assignment and network planning — named boundary polygons (WGS 84) linked to sites, with planned/active/retired status and map colour |
| 58 | `coverage_zones` | Coverage zones within a service area — finer-grained polygons describing network reach, access technology (fiber, fixed wireless, DSL, cable, satellite, LTE, 5G), maximum speeds, and build-out status |
| 59 | `sla_definitions` | SLA terms per plan — uptime guarantees (e.g. 99.95%), maximum response and resolution times, compensation rules for SLA breaches, measurement periods, and maintenance-window exclusions |
| 60 | `device_config_backups` | Versioned configuration snapshots per device — stores MikroTik exports, RouterOS backups, Cisco running-config, and similar captures with SHA-256 checksums for change detection, version tracking, and capture method (manual, scheduled, pre/post change) |
| 61 | `client_mx_profiles` | Mexico extension for clients (1:1) — required when `clients.locale = 'MX'` and at least one contract has `facturar = TRUE`; stores RFC, CURP, razon_social, regimen_fiscal, codigo_postal_fiscal, and Mexican address fields for CFDI 4.0 compliance |
| 62 | `organization_mx_profiles` | Mexico extension for organizations (1:1) — required when `organizations.locale = 'MX'`; stores RFC, razon_social, CSD digital-seal certificate, PAC stamping credentials, CFDI series/folio numbering, and Mexican address fields |
| 63 | `sat_regimen_fiscal` | SAT catalog c_RegimenFiscal — fiscal regime codes (601–626) used on CFDI 4.0 issuer and receptor nodes |
| 64 | `sat_uso_cfdi` | SAT catalog c_UsoCFDI — permitted use codes for the CFDI receptor (G01, G03, S01, CP01, etc.) |
| 65 | `sat_forma_pago` | SAT catalog c_FormaPago — payment instrument codes (01=cash, 03=SPEI, 28=debit card, 99=TBD, etc.) |
| 66 | `sat_metodo_pago` | SAT catalog c_MetodoPago — payment timing: PUE (single payment) or PPD (installments / deferred) |
| 67 | `sat_tipo_comprobante` | SAT catalog c_TipoDeComprobante — CFDI document type: I=ingreso, E=egreso, P=pago, T=traslado, N=nómina |
| 68 | `sat_moneda` | SAT catalog c_Moneda (subset) — currencies accepted in CFDI 4.0: MXN, USD, EUR, XXX |
| 69 | `cfdi_documents` | Core CFDI 4.0 fiscal document records linked to invoices, credit notes, and payments — stores folio fiscal UUID, XML, PDF URL, PAC stamping metadata, SAT status, and receiver snapshot |
| 70 | `cfdi_related_documents` | CfdiRelacionados rows per CFDI document — records relationships between CFDIs (e.g. credit note referencing original invoice, substitution of cancelled CFDI) |
| 71 | `cfdi_payment_complements` | Complemento de Pago 2.0 headers — one per payment event for PPD invoices; records payment date, payment form, amounts, and bank details |
| 72 | `cfdi_payment_complement_items` | DoctoRelacionado rows per Complemento de Pago — links each payment event to the specific PPD invoices being settled with balance tracking |
| 73 | `concession_titles` | IFT/CRT concession title registry — tracks title number, type, authorized services, spectrum bands, validity dates, and regulatory status for each organization |
| 74 | `regulatory_filings` | IFT/CRT periodic filing log — annual reports, quarterly stats, tariff registrations, QoS reports, and other LFTR-mandated submissions |
| 75 | `contract_templates_mx` | IFT/CRT-registered Carta de Adhesión templates — stores the registered standard contract model including registration number, version, body text, and approval status |
| 76 | `ift_statistical_reports` | Pre-aggregated IFT/CRT reporting snapshots — subscriber counts by speed tier/state/technology, average speeds, coverage municipalities, and revenue per reporting period |
| 77 | `sat_clave_prod_serv` | SAT catalog c_ClaveProdServ — product and service classification codes (e.g. `81161700` for internet access) required on every CFDI 4.0 line item |
| 78 | `sat_clave_unidad` | SAT catalog c_ClaveUnidad — unit-of-measure codes (e.g. `E48` for service unit, `H87` for piece) required on every CFDI 4.0 line item |
| 79 | `cfdi_conceptos` | CFDI 4.0 concept (line item) rows — one per `<Concepto>` node; stores SAT product/service key, unit key, quantity, description, unit price, line total, optional discount, and ObjetoImp indicator |
| 80 | `cfdi_concepto_impuestos` | Per-line tax breakdown for CFDI 4.0 — one row per `<Traslado>` or `<Retencion>` inside a concept; stores tax type, SAT tax code (ISR/IVA/IEPS), rate type, rate, taxable base, and calculated tax amount |
| 81 | `factura_publica_invoices` | Factura pública (venta al público en general) periodic aggregation documents — when MX contracts have `facturar = FALSE`, their invoices are aggregated into a periodic factura pública per SAT InformacionGlobal (Periodicidad, Meses, Año); one row per organization per period |
| 82 | `factura_publica_invoice_items` | Junction table linking individual invoices from contracts with `facturar = FALSE` to their parent factura pública — each invoice belongs to at most one factura pública document |
| 83 | `cfdi_payment_complement_item_taxes` | Per-DoctoRelacionado tax breakdown (ImpuestosP) for Complemento de Pago 2.0 — one row per `<Traslado>` or `<Retencion>` inside a payment complement item; stores tax type, SAT tax code, rate type, rate, taxable base, and calculated tax amount |
| 84 | `payment_gateways` | Payment gateway provider configuration per organization (Stripe, Conekta, OpenPay, MercadoPago, PayPal, manual) — stores environment, encrypted credentials, webhook secrets, and provider-specific JSON config |
| 85 | `payment_transactions` | Raw gateway transaction log for every payment attempt — provider reference ID, gateway status, raw request/response payloads, webhook data, and idempotency key for auditing and reconciliation |
| 86 | `recurring_payment_profiles` | Stored card / token per client for autopay (recurring charges) — gateway customer ID or card token, card brand, last four digits, expiry, and lifecycle status |
| 87 | `suspension_rules` | Configurable suspension rules per organization — days-past-due threshold, grace period, action (auto_suspend / notify_only / auto_disconnect), optional plan-ID scoping |
| 88 | `suspension_logs` | History of suspend / unsuspend / disconnect / reconnect events per contract — triggering rule, performer, RADIUS CoA sent/response, and linked invoice |
| 89 | `csd_certificates` | CSD (Certificado de Sello Digital) storage per organization for SAT CFDI 4.0 stamping — PEM-encoded public certificate, encrypted private key, SHA-256 fingerprint, and expiry monitoring |
| 90 | `pac_providers` | PAC (Proveedor Autorizado de Certificación) provider credentials and endpoint configuration per organization — supports Finkok, SW Sapien, Digicel, Comercio Digital, FacturAPI with sandbox/production environments |
| 91 | `webhooks` | Outbound webhook registrations per organization — target URL, HMAC signing secret, JSON event subscriptions, max retries, and timeout configuration |
| 92 | `webhook_deliveries` | Delivery log for outbound webhooks — HTTP status, response body, response time, attempt number, retry scheduling, and delivery outcome |
| 93 | `organization_users` | Pivot table linking users to organizations with per-organization roles (owner, admin, manager, technician, billing, readonly) — enables multi-tenant user membership |
| 94 | `plan_addons` | Catalog of plan add-ons available for sale per organization — static IP, extra IP block, extra bandwidth, equipment rental; price and billing cycle (monthly / one-time / yearly) |
| 95 | `contract_addons` | Add-ons attached to a specific client contract — references plan_addons catalog, stores contracted quantity, negotiated unit price, validity window, and lifecycle status |
| 96 | `speed_tests` | Speed test results from client portal, technician tools, automated probes, or external services — download/upload Mbps, latency, jitter, packet loss for SLA correlation |
| 97 | `ticket_sla_events` | SLA tracking events per support ticket — first-response time, resolution time, escalation, breach warnings, and breaches; pairs with sla_definitions for target comparison |
| 98 | `sms_logs` | SMS and WhatsApp notification logging per organization — complements email_logs for non-email channels; captures direction, provider, delivery status, cost, and timestamps |
| 99 | `revenue_summary` | Materialized revenue summary for MRR / churn / ARPU reporting — populated by a scheduled task (not a view); one row per organization per calendar month per currency |
| 100 | `network_health_snapshots` | Aggregated daily device uptime and link utilization snapshots — uptime %, avg/peak latency, avg/peak throughput in/out, packet loss, total downtime minutes |
| 101 | `cfdi_cancellations` | SAT CFDI cancellation audit trail — cancellation reason code (motivo 01–04), optional replacement UUID (folio_sustitucion), PAC response status, and raw acuse XML acknowledgement |

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

> **Migration 121 — Seed default tax rates:** `121_seed_default_tax_rates.sql` inserts four globally applicable default tax rates (`organization_id = NULL`): Tax Exempt (0 %), Standard Tax 8 %, IVA 16 % (Mexico), and GST 5 % (Canada). Uses `WHERE NOT EXISTS` guards for full idempotency since the `tax_rates` table does not carry a `UNIQUE` constraint on `name` alone.

> **Migration 122 — Seed default suspension rule:** `122_seed_default_suspension_rule.sql` inserts a default auto-suspend rule into `suspension_rules` for the first organization (id = 1): 30 days past due, 5-day grace period, action `auto_suspend`. Uses `WHERE NOT EXISTS` to be idempotent. Because `suspension_rules.organization_id` is `NOT NULL`, this seed targets org id = 1; administrators should add per-organization rules as part of tenant onboarding.

> **Migration 123 — Seed scheduled tasks for core automation:** `123_seed_scheduled_tasks_core_automation.sql` inserts the five system-level automation tasks that drive FireISP's main operational loops: `auto_generate_invoices` (daily at 01:00), `auto_suspend_overdue` (daily at 06:00), `radius_sync` (every 5 min), `populate_revenue_summary` (monthly on the 1st at 02:00), and `populate_network_health_snapshots` (daily at 04:00). All tasks use `organization_id = NULL` (global) and `is_enabled = TRUE`. Uses `INSERT IGNORE` on the `UNIQUE KEY (organization_id, task_name)`.

> **Migration 124 — Add currency to expenses (idempotent guard):** `124_add_currency_to_expenses.sql` adds `expenses.currency CHAR(3) NOT NULL DEFAULT 'USD'` after the `amount` column for multi-currency expense tracking. The migration is wrapped in a stored-procedure guard that checks `INFORMATION_SCHEMA.COLUMNS` before issuing the `ALTER TABLE`, making it a safe no-op on installations where migration 051 already applied the same column.

> **Migration 125 — Add tax_rate_id to line-item tables:** `125_add_tax_rate_id_to_line_item_tables.sql` adds a `tax_rate_id BIGINT UNSIGNED NULL` foreign-key column to `invoice_items`, `quote_items`, and `credit_note_items`. `NULL` means "inherit the rate from the parent document". This enables per-line-item tax rates for mixed-rate invoices common in multi-tax-rate jurisdictions (e.g. different rates for hardware vs. services). `ON DELETE SET NULL` prevents cascading deletes when a `tax_rates` row is removed.

> **Migration 126 — Payment allocation balance guard triggers:** `126_payment_allocation_balance_guard_triggers.sql` adds four `BEFORE INSERT / BEFORE UPDATE` triggers on `payment_allocations` that enforce two financial integrity rules at the database level: (1) the total allocated amount for a payment cannot exceed `payments.amount`, and (2) the total allocated amount for an invoice cannot exceed `invoices.total`. Both violations raise `SQLSTATE '45000'` with descriptive messages. Uses `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER` for safe re-runs.

> **Migration 127 — Inventory stock negative guard trigger:** `127_inventory_stock_negative_guard_trigger.sql` adds a `BEFORE UPDATE` trigger on `inventory_stock` that raises `SQLSTATE '45000'` when a stock update would set `quantity < 0`. This prevents physically impossible inventory state from silently corrupting reports and downstream job fulfillment. Uses `DROP TRIGGER IF EXISTS` for safe re-runs.

> **Migration 128 — PPPoE contract RADIUS consistency trigger:** `128_connection_type_radius_consistency_trigger.sql` adds a `BEFORE UPDATE` trigger on `contracts` that raises `SQLSTATE '45000'` when a contract with `connection_type IN ('pppoe', 'pppoe_dual')` is activated (`status` changed to `'active'`) without at least one corresponding `radius` row. Contracts start in `pending` status so RADIUS accounts can be provisioned before activation; the guard fires only at activation time. Uses `DROP TRIGGER IF EXISTS` for safe re-runs.

> **Migration 129 — Composite indexes for query performance:** `129_add_composite_indexes_for_query_performance.sql` adds five composite indexes for common multi-column query patterns: `idx_invoices_currency_status ON invoices(currency, status)`, `idx_payment_transactions_gateway_id_status ON payment_transactions(payment_gateway_id, gateway_status)`, `idx_expenses_currency ON expenses(currency)`, `idx_contracts_client_facturar ON contracts(client_id, facturar)`, and `idx_suspension_logs_contract_created ON suspension_logs(contract_id, created_at)`. Each index is guarded via `INFORMATION_SCHEMA.STATISTICS` in a stored procedure for safe re-runs. Note: `webhook_deliveries.next_retry_at` already has a single-column index from migration 109.

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

Documentation and setup instructions will be added as the project develops.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
