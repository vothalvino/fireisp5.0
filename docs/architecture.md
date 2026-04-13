# FireISP 5.0 — Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Admin Dashboard (SPA)                        │
│                   public/ — Vanilla HTML/CSS/JS                     │
│          Login → Dashboard → Clients/Invoices/Tickets/Devices       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP/HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Express Application (src/app.js)                 │
│                                                                     │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ Helmet  │  │   CORS   │  │ Rate     │  │ Request Logger    │   │
│  │ Security│  │ Origins  │  │ Limiters │  │ (Pino)            │   │
│  └─────────┘  └──────────┘  └──────────┘  └───────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               Authentication & Authorization                 │   │
│  │  JWT + Refresh Rotation │ TOTP 2FA │ RBAC Permissions       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────── API Routes (68 files) ──────────────────┐   │
│  │ /api/v1/auth      /api/v1/clients     /api/v1/invoices      │   │
│  │ /api/v1/contracts  /api/v1/payments    /api/v1/tickets       │   │
│  │ /api/v1/devices    /api/v1/billing     /api/v1/cfdi          │   │
│  │ /api/v1/radius     /api/v1/alerts      /api/v1/events (SSE) │   │
│  │ /api/v1/...        /metrics (Prometheus)                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────── Validation (62 Joi schemas) ────────────────┐   │
│  │ Input validation │ Sanitization │ OpenAPI spec generation    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
┌───────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  Business Logic   │ │  Event Bus   │ │   Scheduled      │
│  (Services)       │ │  (Pub/Sub)   │ │   Tasks (Cron)   │
│                   │ │              │ │                   │
│ billingService    │ │ Events:      │ │ alert_evaluation  │
│ cfdiService       │ │ invoice.*    │ │ billing_cycle     │
│ suspensionService │ │ payment.*    │ │ suspension_check  │
│ alertService      │ │ contract.*   │ │ snmp_polling      │
│ radiusService     │ │ device.*     │ │ backup            │
│ pdfService        │ │ alert.*      │ │                   │
│ usageService      │ │ ticket.*     │ │                   │
│ reportService     │ │ outage.*     │ │                   │
│ checkoutService   │ │              │ │                   │
│ paymentGateway    │ │ Listeners:   │ │                   │
│ twoFactorService  │ │ notification │ │                   │
│                   │ │ Hooks        │ │                   │
└────────┬──────────┘ └──────┬───────┘ └────────┬──────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Data Layer                                    │
│                                                                     │
│  ┌────────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │  MySQL 8.0     │  │   Models     │  │  Migrations (136+)    │   │
│  │  (mysql2 pool) │  │  BaseModel   │  │  Triggers & Events    │   │
│  │                │  │  50+ entities│  │  Stored Procedures    │   │
│  └────────────────┘  └──────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Invoice Generation

```
Contract (active)
    │
    ▼
billingService.generateBillingPeriod()
    │  Creates billing_periods record
    ▼
billingService.generateInvoice()
    │  Creates invoice + line items
    │  Debits client balance ledger
    │  Emits "invoice.created" event
    ▼
Event Bus → notificationHooks
    │  Sends invoice email to client
    ▼
paymentGatewayService (Stripe / Conekta)
    │  Processes payment via webhook
    │  Emits "payment.received" event
    ▼
billingService.recordPaymentCredit()
    │  Credits client balance ledger
    ▼
cfdiService.generateXml() → stamp()
    │  Generates CFDI 4.0 XML
    │  Stamps with PAC provider
    ▼
pdfService.generateInvoicePdf()
    │  Creates PDF with CFDI data
```

## Data Flow: Suspension Lifecycle

```
Scheduled Task: suspension_check (every hour)
    │
    ▼
suspensionService.evaluateRules(orgId)
    │  Finds contracts with overdue invoices
    │  Matches against suspension_rules
    ▼
  ┌─── Within warning window? ───┐
  │ YES                          │ NO (past grace period)
  ▼                              ▼
Emit "suspension.warning"    suspensionService.suspendContract()
  │  Send warning email         │  UPDATE contract → suspended
  │                              │  RADIUS Disconnect-Request (UDP)
  │                              │  Emit "contract.suspended"
  │                              │  Log in suspension_logs
  │                              ▼
  │                           Client pays overdue invoice
  │                              │
  │                              ▼
  │                     suspensionService.reconnectContract()
  │                              │  UPDATE contract → active
  │                              │  RADIUS CoA-Request (UDP)
  │                              │  Emit "contract.restored"
  └──────────────────────────────┘
```

## Data Flow: Monitoring Alerts

```
Scheduled Task: alert_evaluation (every 5 min)
    │
    ▼
alertService.evaluateAlerts(orgId)
    │  Loads enabled alert_rules
    │  Queries snmp_metrics / network_health_snapshots
    ▼
  ┌─── Threshold breached? ───┐
  │ YES                       │ NO
  ▼                           └── (no action)
Record alert_event
    │
    ├── Emit "alert.triggered"
    │       └── notificationHooks → email/SMS
    │
    └── auto_create_outage?
            │ YES
            ▼
        INSERT outage record
            │
            ▼
        Emit "outage.reported"
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Express 5 | Mature, huge ecosystem, async error handling |
| Database | MySQL 8.0 | Triggers, events, partitioning, RADIUS compat |
| Auth | JWT + refresh rotation | Stateless, scalable, secure rotation |
| Real-time | SSE (not WebSocket) | Simpler, works through proxies, one-way push |
| PDF | PDFKit | No external deps, full control, CFDI compliance |
| i18n | Custom `t()` function | Lightweight, no heavy framework needed |
| Metrics | Hand-rolled Prometheus | Zero deps, exact format control |
| Clustering | FireRelay (custom) | Master-worker node coordination via HTTP |
| Rate limiting | express-rate-limit | Configurable per-tier, env-var overrides |
| Validation | Joi schemas | 62 schema files, auto-loaded for OpenAPI |
