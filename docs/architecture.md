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
│  ┌──────────────────── API Routes (69 files) ──────────────────┐   │
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
│  │  MySQL 8.0     │  │   Models     │  │  Migrations (150)     │   │
│  │  (mysql2 pool) │  │  BaseModel   │  │  Triggers & Events    │   │
│  │                │  │  89 entities │  │  Stored Procedures    │   │
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

## Circuit Breaker Pattern

External service calls (RADIUS, payment gateways, PAC stamping) are wrapped in
a reusable circuit breaker (`src/utils/circuitBreaker.js`) that prevents
cascading failures when a downstream service is unavailable.

```
                 ┌──────────┐
        success  │  CLOSED  │  request passes through
        ◄────────│ (normal) │────────►  external call
                 └────┬─────┘
                      │ failure count ≥ threshold (5)
                      ▼
                 ┌──────────┐
        fail     │   OPEN   │  requests fail instantly
        fast ◄───│ (tripped)│  (no external call made)
                 └────┬─────┘
                      │ cooldown expires (60 s)
                      ▼
                 ┌──────────────┐
                 │  HALF-OPEN   │  one probe request allowed
                 │  (testing)   │──► success → CLOSED
                 └──────┬───────┘──► failure → OPEN
                        │
```

**Configuration** (per-breaker, set at creation time):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `threshold` | 5 | Consecutive failures before tripping |
| `cooldownMs` | 60 000 | Milliseconds to wait before probing |

**Usage in services:**

| Service | Breaker Instance | Protects |
|---------|-----------------|----------|
| `radiusService` | `radiusCircuitBreaker` | RADIUS CoA / Disconnect-Request |
| `paymentGatewayService` | `paymentCircuitBreaker` | Stripe / Conekta / OpenPay calls |
| `cfdiService` | `cfdiCircuitBreaker` | PAC stamping (Finkok, SW Sapien) |
| `firerelayService` | per-node breaker | Fan-out requests to relay nodes |

When a breaker trips, the service logs a warning and returns a structured error
(`CIRCUIT_OPEN`) so callers can handle the outage gracefully (e.g., retry later,
queue for background processing).

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

## Authentication & Authorization Flow

```
                         ┌──────────────────────────────────────────┐
                         │            LOGIN REQUEST                  │
                         │  POST /api/v1/auth/login                 │
                         │  { email, password }                     │
                         └──────────────────┬───────────────────────┘
                                            │
                                            ▼
                         ┌──────────────────────────────────────────┐
                         │           authService.login()            │
                         │  1. Validate credentials (bcrypt)        │
                         │  2. Check user.status === 'active'       │
                         │  3. Check org-level permissions          │
                         └──────────────────┬───────────────────────┘
                                            │
                        ┌───── 2FA enabled? ─┴──────────────┐
                        │ YES                               │ NO
                        ▼                                   ▼
         ┌──────────────────────────────┐    ┌──────────────────────────┐
         │    twoFactorService          │    │  Issue token pair        │
         │  1. Prompt for TOTP code     │    │  JWT (15 min) +          │
         │  2. Verify via speakeasy     │    │  refresh token (7 d)     │
         │                              │    │  Store refresh in        │
         │  ┌── Valid TOTP? ──┐         │    │  refresh_tokens table    │
         │  │ YES     │ NO    │         │    └──────────────────────────┘
         │  │         ▼       │         │
         │  │  Try backup     │         │
         │  │  codes (hashed) │         │
         │  │    │            │         │
         │  │    ├─ match ──► │         │
         │  │    │  burn code │         │
         │  │    │            │         │
         │  │    └─ no match  │         │
         │  │       → 401     │         │
         │  └────────┬────────┘         │
         └───────────┼──────────────────┘
                     ▼
      ┌──────────────────────────────────┐
      │  Issue token pair                │
      │  JWT (15 min) + refresh (7 d)    │
      └──────────────────────────────────┘


  SUBSEQUENT REQUESTS
  ════════════════════

  Client Request + Authorization: Bearer <JWT>
      │
      ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                   Auth Middleware Pipeline                       │
  │                                                                  │
  │  1. Extract token ──► 2. Verify JWT ──► 3. Decode payload       │
  │     from header          (jsonwebtoken)    { userId, orgId,     │
  │                                              role }             │
  │                                                                  │
  │  4. RBAC Permission Check                                       │
  │     ┌─────────────────────────────────────────────────────┐     │
  │     │  Load role → role_permissions → permissions          │     │
  │     │  Match required permission against user's set        │     │
  │     │  (e.g., "invoices:write", "devices:read")           │     │
  │     │                                                      │     │
  │     │  Deny (403) if permission missing                    │     │
  │     │  Allow if permission present → next()                │     │
  │     └─────────────────────────────────────────────────────┘     │
  └──────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
                          Route Handler


  TOKEN REFRESH
  ═════════════

  POST /api/v1/auth/refresh  { refreshToken }
      │
      ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  authService.refreshTokens()                                     │
  │                                                                  │
  │  1. Look up refresh token in refresh_tokens table                │
  │  2. Validate: not expired, not revoked                           │
  │  3. Revoke old refresh token (UPDATE revoked_at = NOW())         │
  │  4. Issue new JWT (15 min) + new refresh token (7 d)             │
  │  5. Store new refresh token in refresh_tokens table              │
  │  6. Return new pair to client                                    │
  │                                                                  │
  │  If old token already revoked → revoke entire family             │
  │  (token reuse detection — possible theft)                        │
  └──────────────────────────────────────────────────────────────────┘
```

## Service Dependency Graph

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                          scheduler (cron)                               │
  │  Triggers: billingService, suspensionService, alertService,            │
  │            snmpPoller, retentionService                                 │
  └────┬──────────┬──────────────┬──────────────┬──────────────┬───────────┘
       │          │              │              │              │
       ▼          ▼              ▼              ▼              ▼
  ┌─────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ ┌─────────────┐
  │ billing │ │ suspension   │ │  alert     │ │  snmp    │ │ retention   │
  │ Service │ │ Service      │ │  Service   │ │  Poller  │ │ Service     │
  └──┬──┬───┘ └──┬───┬───────┘ └──┬───┬─────┘ └──────────┘ └─────────────┘
     │  │        │   │            │   │
     │  │        │   │            │   └────────────────────┐
     │  │        │   │            │  depends on            │
     │  │        │   │            ▼                        ▼
     │  │        │   │     ┌────────────┐          ┌────────────┐
     │  │        │   │     │ snmpPoller │          │    db      │
     │  │        │   │     │ (metrics)  │          │ (MySQL 8)  │
     │  │        │   │     └────────────┘          └────────────┘
     │  │        │   │                                    ▲
     │  │        │   └──────────────────────────┐         │
     │  │        │  depends on                  │    used by all
     │  │        ▼                              │    services
     │  │  ┌──────────────┐              ┌──────┴──────┐
     │  │  │ radiusService│              │  eventBus   │
     │  │  └──────┬───────┘              │  (pub/sub)  │
     │  │         │                      └──────┬──────┘
     │  │         ▼                             │
     │  │  ┌──────────────┐                     │
     │  │  │ circuit      │                     ▼
     │  │  │ breaker      │◄────────── ┌─────────────────────┐
     │  │  │ (UDP CoA /   │           │ notificationHooks   │
     │  │  │  Disconnect) │           │ depends on:         │
     │  │  └──────────────┘           │  eventBus,          │
     │  │         ▲                   │  emailTransport,    │
     │  │         │                   │  webhookService     │
     │  │         │                   └─────────┬───────────┘
     │  │    also used by:                      │
     │  │    paymentGatewayService,             ▼
     │  │    cfdiService,               ┌──────────────┐
     │  │    firerelayService           │ webhookService│
     │  │                               │ depends on:   │
     │  ▼                               │  db,          │
     │  ┌───────────┐                   │  encryption   │
     │  │ pdfService│                   │  (HMAC)       │
     │  └───────────┘                   └──────────────┘
     │        ▲
     │        │ also used by
     │        │ reportService
     ▼        │
  ┌─────────────────────┐       ┌─────────────────────────────┐
  │ checkoutService     │       │ paymentGatewayService       │
  │ depends on:         │──────►│ depends on:                 │
  │  paymentGateway,    │       │  db, encryption,            │
  │  billingService     │       │  circuit breaker            │
  └─────────────────────┘       └──────────────┬──────────────┘
                                               │
                                               │ used by
                                               ▼
                                ┌─────────────────────────────┐
                                │ cfdiService                  │
                                │ depends on:                  │
                                │  db,                         │
                                │  paymentGatewayService       │
                                │   (payment complements),     │
                                │  circuit breaker             │
                                └─────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  Optional Infrastructure Dependencies                              │
  │                                                                     │
  │  ┌────────────────────┐     ┌──────────────────────────────────┐   │
  │  │  cacheService      │     │  jobQueueService                 │   │
  │  │  depends on:       │     │  depends on:                     │   │
  │  │   Redis (optional) │     │   Redis / BullMQ (optional)      │   │
  │  └────────────────────┘     └──────────────────────────────────┘   │
  │                                                                     │
  │  ┌────────────────────┐     ┌──────────────────────────────────┐   │
  │  │  usageService      │     │  firerelayService                │   │
  │  │  depends on:       │     │  depends on:                     │   │
  │  │   db (RADIUS       │     │   db, circuit breaker            │   │
  │  │   accounting data) │     │   (per-node)                     │   │
  │  └────────────────────┘     └──────────────────────────────────┘   │
  │                                                                     │
  │  ┌────────────────────┐                                            │
  │  │  reportService     │                                            │
  │  │  depends on:       │                                            │
  │  │   db, pdfService   │                                            │
  │  └────────────────────┘                                            │
  └─────────────────────────────────────────────────────────────────────┘
```

**Full dependency summary:**

| Service | Dependencies |
|---------|-------------|
| `billingService` | db, eventBus, pdfService |
| `cfdiService` | db, paymentGatewayService (payment complements), circuit breaker |
| `suspensionService` | db, radiusService, eventBus |
| `alertService` | db, snmpPoller (metrics data), eventBus |
| `paymentGatewayService` | db, encryption, circuit breaker |
| `checkoutService` | paymentGatewayService, billingService |
| `notificationHooks` | eventBus, emailTransport, webhookService |
| `webhookService` | db, encryption (HMAC secrets) |
| `radiusService` | circuit breaker (UDP CoA / Disconnect) |
| `scheduler` | billingService, suspensionService, alertService, snmpPoller, retentionService |
| `firerelayService` | db, circuit breaker (per-node) |
| `cacheService` | Redis (optional) |
| `jobQueueService` | Redis / BullMQ (optional) |
| `usageService` | db (RADIUS accounting data) |
| `reportService` | db, pdfService |

## Event Bus Topology

```
  PUBLISHERS                    EVENTS                       SUBSCRIBERS
  ══════════                    ══════                       ═══════════

  ┌──────────────────┐
  │  billingService  │───┬── invoice.created ──────┬──► notificationHooks
  │                  │   │                          └──► webhookService
  │                  │   │
  │                  │   └── invoice.overdue ───────┬──► notificationHooks
  └──────────────────┘                              └──► webhookService

  ┌──────────────────┐
  │  paymentGateway  │───┬── payment.received ─────┬──► notificationHooks
  │  Service         │   │                          ├──► billingService
  │                  │   │                          └──► webhookService
  │                  │   │
  │                  │   └── payment.failed ────────┬──► notificationHooks
  └──────────────────┘                              └──► webhookService

  ┌──────────────────┐
  │  suspension      │───┬── contract.suspended ───┬──► notificationHooks
  │  Service         │   │                          └──► webhookService
  │                  │   │
  │                  │   ├── contract.restored ─────┬──► notificationHooks
  │                  │   │                          └──► webhookService
  │                  │   │
  │                  │   └── suspension.warning ────┬──► notificationHooks
  └──────────────────┘                              └──► webhookService

  ┌──────────────────┐
  │  alertService    │───── alert.triggered ────────┬──► notificationHooks
  └──────────────────┘                              └──► webhookService

  ┌──────────────────┐
  │  General         │───┬── device.created ────────┬──► notificationHooks
  │  (various        │   │                          └──► webhookService
  │   services)      │   │
  │                  │   ├── device.updated ────────┬──► notificationHooks
  │                  │   │                          └──► webhookService
  │                  │   │
  │                  │   ├── ticket.created ────────┬──► notificationHooks
  │                  │   │                          └──► webhookService
  │                  │   │
  │                  │   ├── ticket.updated ────────┬──► notificationHooks
  │                  │   │                          └──► webhookService
  │                  │   │
  │                  │   ├── outage.reported ───────┬──► notificationHooks
  │                  │   │                          └──► webhookService
  │                  │   │
  │                  │   └── outage.resolved ───────┬──► notificationHooks
  └──────────────────┘                              └──► webhookService
```

**Event routing summary:**

| Publisher | Event | Subscribers |
|-----------|-------|-------------|
| `billingService` | `invoice.created` | notificationHooks, webhookService |
| `billingService` | `invoice.overdue` | notificationHooks, webhookService |
| `paymentGatewayService` | `payment.received` | notificationHooks, billingService, webhookService |
| `paymentGatewayService` | `payment.failed` | notificationHooks, webhookService |
| `suspensionService` | `contract.suspended` | notificationHooks, webhookService |
| `suspensionService` | `contract.restored` | notificationHooks, webhookService |
| `suspensionService` | `suspension.warning` | notificationHooks, webhookService |
| `alertService` | `alert.triggered` | notificationHooks, webhookService |
| (various) | `device.created` | notificationHooks, webhookService |
| (various) | `device.updated` | notificationHooks, webhookService |
| (various) | `ticket.created` | notificationHooks, webhookService |
| (various) | `ticket.updated` | notificationHooks, webhookService |
| (various) | `outage.reported` | notificationHooks, webhookService |
| (various) | `outage.resolved` | notificationHooks, webhookService |

## CFDI 4.0 Stamping Flow

```
  Invoice generated (billingService)
      │
      ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  1. cfdiService.generateXml()                                       │
  │     Build CFDI 4.0 XML document                                     │
  │     ┌────────────────────────────────────────────────────────────┐  │
  │     │  - Emisor / Receptor (RFC, regimen fiscal)                 │  │
  │     │  - Conceptos (line items with SAT catalog codes):          │  │
  │     │      ClaveProdServ, ClaveUnidad, ObjetoImp                 │  │
  │     │  - Impuestos (IVA 16%, retenciones)                        │  │
  │     │  - FormaPago, MetodoPago, UsoCFDI, Moneda                  │  │
  │     └────────────────────────────────────────────────────────────┘  │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  2. Sign with CSD certificate (X.509)                               │
  │     - Load .cer + .key from encrypted storage                       │
  │     - Build original chain string (cadena original)                 │
  │     - SHA-256 digest → RSA-SHA256 signature                         │
  │     - Embed Sello (signature) + NoCertificado in XML                │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  3. Send to PAC provider via circuit breaker                        │
  │                                                                      │
  │     ┌────────────┐    ┌──────────────┐    ┌───────────────┐         │
  │     │   Finkok   │    │  SW Sapien   │    │  FacturAPI    │         │
  │     └──────┬─────┘    └──────┬───────┘    └───────┬───────┘         │
  │            │                 │                     │                  │
  │            └────────┬────────┴─────────────────────┘                 │
  │                     │                                                │
  │              cfdiCircuitBreaker                                      │
  │              (threshold: 5, cooldown: 60 s)                          │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  4. Receive stamping response                                       │
  │     - UUID (folio fiscal)                                           │
  │     - SelloSAT (PAC digital stamp)                                  │
  │     - SelloCFD (taxpayer digital stamp)                              │
  │     - FechaTimbrado (stamping timestamp)                             │
  │     - NoCertificadoSAT                                              │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  5. Store cfdi_document record                                      │
  │     - UUID, XML blob, status = 'stamped'                            │
  │     - Link to invoice_id, org_id                                    │
  │     - SAT response metadata                                         │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  6. pdfService.generateInvoicePdf()                                 │
  │     - Fiscal data: UUID, sello, cadena original                     │
  │     - QR code (SAT verification URL)                                │
  │     - Emisor / Receptor details                                     │
  └──────────────────────────────────────────────────────────────────────┘


  COMPLEMENTO DE PAGO (partial payments)
  ═══════════════════════════════════════

  Client makes partial payment on PPD invoice
      │
      ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  cfdiService.generatePaymentComplement()                            │
  │                                                                      │
  │  1. Look up related cfdi_document (original invoice)                │
  │  2. Query paymentGatewayService for payment details                 │
  │  3. Build Complemento de Pago 2.0 XML:                              │
  │     - Pago: FechaPago, FormaDePagoP, MonedaP, Monto, TipoCambioP   │
  │     - DoctoRelacionado: IdDocumento (UUID), Serie, Folio,           │
  │       ImpSaldoAnt, ImpPagado, ImpSaldoInsoluto, ObjetoImpDR        │
  │  4. Sign + stamp via PAC (same circuit breaker flow)                │
  │  5. Store as cfdi_document with tipo = 'payment_complement'         │
  └──────────────────────────────────────────────────────────────────────┘


  CANCELLATION WORKFLOW
  ═════════════════════

  Operator requests cancellation
      │
      ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  cfdiService.cancelCfdi()                                           │
  │                                                                      │
  │  1. Validate cancellation reason (SAT motivo: 01, 02, 03, 04)       │
  │  2. If motivo 01 → require folio_sustitucion (replacement UUID)     │
  │  3. Send cancellation request to PAC via circuit breaker             │
  │  4. PAC forwards to SAT                                             │
  │  5. SAT responds with EstatusUUID:                                  │
  │     ┌────────────────────────────────────────────────────────┐      │
  │     │  "Cancelado"          → immediate cancellation         │      │
  │     │  "En proceso"         → awaiting receptor acceptance   │      │
  │     │  "No cancelable"      → rejection (log reason)         │      │
  │     └────────────────────────────────────────────────────────┘      │
  │  6. INSERT cfdi_cancellations record:                               │
  │     cancellation_uuid, motivo, estatus, requested_at                │
  │  7. UPDATE cfdi_document.status = 'cancelled' | 'cancel_pending'    │
  └──────────────────────────────────────────────────────────────────────┘
```

## Data Retention Architecture

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                       scheduler (cron)                              │
  │                  data_retention job — daily                         │
  └──────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                   retentionService.runAll()                         │
  │                                                                     │
  │  For each data type:                                                │
  │  1. Read TTL from env var (with defaults)                           │
  │  2. SELECT ids WHERE created_at < NOW() - INTERVAL <TTL>           │
  │  3. DELETE in batches (1 000 rows per batch)                        │
  │  4. Sleep between batches to avoid long locks                       │
  │  5. Log rows deleted per type                                       │
  └──────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                   Retention Targets                                 │
  │                                                                     │
  │  ┌──────────────────────┬────────────────┬────────────────────┐    │
  │  │  Data Type           │ Default TTL    │ Env Override       │    │
  │  ├──────────────────────┼────────────────┼────────────────────┤    │
  │  │  audit_logs          │ 365 days       │ RETENTION_AUDIT    │    │
  │  │  alert_events        │  90 days       │ RETENTION_ALERTS   │    │
  │  │  webhook_deliveries  │  90 days       │ RETENTION_WEBHOOKS │    │
  │  │  email_logs          │ 180 days       │ RETENTION_EMAIL    │    │
  │  │  sms_logs            │ 180 days       │ RETENTION_SMS      │    │
  │  │  idempotency_keys    │   7 days       │ RETENTION_IDEMPOT  │    │
  │  └──────────────────────┴────────────────┴────────────────────┘    │
  └─────────────────────────────────────────────────────────────────────┘


  BATCH DELETION DETAIL
  ═════════════════════

  retentionService.purgeTable(tableName, ttlDays)
      │
      ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  LOOP until no rows remain past TTL:                                │
  │                                                                     │
  │    DELETE FROM <table>                                              │
  │    WHERE created_at < NOW() - INTERVAL <ttlDays> DAY               │
  │    LIMIT 1000;                                                      │
  │                                                                     │
  │    affected = result.affectedRows                                   │
  │                                                                     │
  │    ┌─── affected === 0? ───┐                                       │
  │    │ YES                   │ NO                                     │
  │    ▼                       ▼                                        │
  │  break (done)         sleep(RETENTION_BATCH_DELAY_MS || 500)        │
  │                       continue loop                                 │
  └─────────────────────────────────────────────────────────────────────┘
```

**Retention guarantees:**

- **Hard delete** — rows are permanently removed, not soft-deleted, to reclaim
  disk space and comply with data-minimization policies.
- **Batch processing** — the `LIMIT 1000` per query avoids holding row locks for
  extended periods, keeping the database responsive during purges.
- **Configurable TTLs** — operators override defaults via environment variables
  without code changes or redeployment.
- **Idempotent** — re-running the job has no side effects; it simply finds fewer
  (or zero) rows to delete.
