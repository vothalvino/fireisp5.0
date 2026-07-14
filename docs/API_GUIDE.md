# FireISP 5.0 — API Guide

This guide covers everything a developer needs to integrate with the FireISP REST API.

---

## Table of Contents

1. [Base URL & Versioning](#base-url--versioning)
2. [Authentication](#authentication)
3. [Token Refresh](#token-refresh)
4. [Request & Response Format](#request--response-format)
5. [Pagination](#pagination)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)
8. [Organization Scoping](#organization-scoping)
9. [RBAC Permissions](#rbac-permissions)
10. [Real-Time Events (SSE)](#real-time-events-sse)
11. [Webhook Events](#webhook-events)
12. [Billing Workflow](#billing-workflow)
13. [CFDI 4.0 Workflow (Mexico)](#cfdi-40-workflow-mexico)
14. [File Uploads](#file-uploads)
15. [CSV / PDF Exports](#csv--pdf-exports)
16. [OpenAPI / Swagger](#openapi--swagger)

---

## Base URL & Versioning

```
https://your-domain.com/api/
```

All API endpoints are prefixed with `/api/`. The health check endpoint (`/health`) is the only non-prefixed route. There is no version prefix — the API is versioned by the application release (currently 5.0.0).

---

## Authentication

FireISP uses JWT (JSON Web Tokens) for authentication. Tokens are issued on login and must be included in every authenticated request.

### Register

```http
POST /api/auth/register
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "securePassword123"
}
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Response:**

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "a1b2c3d4e5f6...",
    "expiresIn": 900,
    "user": {
      "id": 1,
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "role": "admin"
    },
    "organizations": [
      { "id": 1, "name": "My ISP", "role": "owner" }
    ]
  }
}
```

### Using the Token

Include the access token (JWT) in the `Authorization` header:

```http
GET /api/clients
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Logout

Send the refresh token in the request body to revoke the session:

```http
POST /api/auth/logout
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

### Get Current User

```http
GET /api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

---

## Token Refresh

Access tokens expire after 60 minutes by default (configurable via `JWT_ACCESS_EXPIRES_IN`). Refresh tokens last 7 days (configurable via `JWT_REFRESH_EXPIRES_IN`). Use the refresh endpoint to rotate your token pair without re-authenticating:

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response:**

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...new...",
    "refreshToken": "f6e5d4c3b2a1...new...",
    "expiresIn": 900
  }
}
```

The old refresh token is immediately invalidated (rotation). Each refresh issues a new token pair. If a previously rotated refresh token is reused, the request is rejected — this helps detect token theft.

---

## Request & Response Format

### Requests

- **Content-Type**: `application/json` for all POST/PUT requests
- **Body size limit**: 10 MB
- Request bodies are stored and returned as submitted — string fields are **not** HTML-entity-encoded on input. XSS defense happens at output sinks instead (React/JSX auto-escaping, `DOMPurify.sanitize()` on the one raw-HTML render in the subscriber portal, and output-encoding at CFDI XML / email-template generation), so clients should not expect or rely on request bodies being transformed before storage

### Responses

**Success (single resource):**

```json
{
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

**Success (list):**

```json
{
  "data": [ ... ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 50,
    "totalPages": 3
  }
}
```

**Success (action):**

```json
{
  "message": "Password changed successfully"
}
```

**Error:**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

---

## Pagination

All list endpoints support pagination via query parameters:

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `page` | 1 | — | Page number (1-based) |
| `limit` | 50 | 100 | Results per page |
| `order_by` | `id` | — | Column to sort by |
| `order` | `ASC` | — | Sort direction (`ASC` or `DESC`) |

**Example:**

```http
GET /api/clients?page=2&limit=25&order_by=created_at&order=DESC
```

**Response meta:**

```json
{
  "meta": {
    "total": 150,
    "page": 2,
    "limit": 25,
    "totalPages": 6
  }
}
```

---

## Error Handling

All errors follow a consistent format with a machine-readable `code` and human-readable `message`. Every error includes a `requestId` that matches the `X-Request-Id` response header for traceability.

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `VALIDATION_ERROR` | Request body validation failed |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Duplicate record (unique constraint) |
| 422 | `DB_RULE_VIOLATION` | Database trigger guard violation |
| 422 | `FK_VIOLATION` | Foreign key constraint violation |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### Validation Errors

Validation errors include a `details` array with per-field messages:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "email is required" },
      { "field": "password", "message": "password must be at least 8 characters" }
    ],
    "requestId": "a1b2c3d4..."
  }
}
```

---

## Rate Limiting

Requests are rate-limited per IP address. Rate limit headers are included in every response:

| Header | Description |
|--------|-------------|
| `RateLimit-Limit` | Maximum requests in window |
| `RateLimit-Remaining` | Remaining requests |
| `RateLimit-Reset` | Seconds until window resets |

### Rate Limit Tiers

| Tier | Limit | Window | Applied To |
|------|-------|--------|------------|
| Auth | 20 req | 15 min | `/api/auth/{login,register,password-reset,change-password,verify-email}` |
| SSE | 10 req | 15 min | `/api/events/*` |
| Export | 20 req | 15 min | `/api/export/*`, `/api/pdf/*` |
| General | 200 req | 15 min | All other `/api/*` |

---

## Organization Scoping

FireISP is multi-tenant. Every authenticated request is scoped to the user's current organization (set in the JWT at login). All CRUD operations automatically filter by `organization_id`.

The organization context is derived from the JWT payload's `orgId` field. If a user belongs to multiple organizations, the primary organization is set at login. Users cannot access data from organizations they don't belong to.

---

## RBAC Permissions

FireISP uses Role-Based Access Control. Each user has a role within each organization, and each role has a set of permissions.

### Permission Format

Permissions follow the pattern `{resource}.{action}`:

```
clients.view, clients.create, clients.update, clients.delete, clients.export
invoices.view, invoices.create, invoices.update, invoices.delete, invoices.export
devices.view, devices.create, devices.update, devices.delete
tickets.view, tickets.create, tickets.update
```

### Admin Bypass

Users with `role: 'admin'` in the legacy `users.role` field bypass all RBAC checks.

---

## Real-Time Events (SSE)

FireISP uses Server-Sent Events (SSE) for real-time push notifications. SSE works through HTTP/2 proxies and load balancers without extra configuration.

### Connecting

```javascript
const eventSource = new EventSource('/api/events/stream', {
  headers: { 'Authorization': 'Bearer ' + token }
});

eventSource.addEventListener('connected', (e) => {
  console.log('Connected:', JSON.parse(e.data));
});

eventSource.addEventListener('invoice.created', (e) => {
  console.log('New invoice:', JSON.parse(e.data));
});
```

### Available Streams

| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `/api/events/stream` | Organization notification feed | Yes |
| `/api/events/metrics` | Live SNMP metrics (admin) | Yes |
| `/api/events/tickets/:id` | Ticket updates for a specific ticket | Yes |
| `/api/events/outages` | Outage alerts for the organization | Yes |
| `/api/events/stats` | Connection statistics (non-SSE, JSON) | Yes |

### Channel Naming

Events are scoped by organization: `org:{orgId}:notifications`, `org:{orgId}:metrics`, etc.

### Keepalive

The server sends `:keepalive` comments every 30 seconds to maintain the connection. Configure your reverse proxy (nginx) to disable buffering for SSE:

```nginx
location /api/events/ {
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
}
```

---

## Webhook Events

FireISP can deliver events to external URLs via webhooks. Webhooks are configured per-organization.

### Supported Events

| Event | Description |
|-------|-------------|
| `*` | All events (wildcard) |
| `client.created` | New client registered |
| `client.updated` | Client record modified |
| `contract.created` | New service contract |
| `contract.suspended` | Contract suspended |
| `contract.restored` | Contract restored from suspension |
| `invoice.created` | New invoice generated |
| `invoice.paid` | Invoice marked as paid |
| `payment.received` | Payment recorded |
| `ticket.created` | New support ticket |
| `ticket.updated` | Ticket status/priority changed |
| `ticket.closed` | Ticket resolved and closed |
| `outage.reported` | New service outage |
| `outage.resolved` | Outage resolved |
| `device.offline` | Monitored device went offline |
| `device.online` | Device came back online |

### Webhook Payload

```json
{
  "event": "invoice.created",
  "data": {
    "id": 42,
    "client_id": 5,
    "total": 499.00,
    "currency": "MXN"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Webhook Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-FireISP-Event` | Event name (e.g., `invoice.created`) |
| `X-FireISP-Signature` | `sha256={hmac_hex}` — HMAC-SHA256 of the request body |

### Verifying Signatures

```javascript
const crypto = require('crypto');

function verifyWebhook(body, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Retry Policy

Failed deliveries are retried up to 3 times with exponential backoff (2s, 4s, 8s). All delivery attempts are logged in the `webhook_deliveries` table.

---

## Billing Workflow

### Automated Billing Cycle

1. **Create Plans** — Define service packages with pricing (`POST /api/plans`)
2. **Create Contracts** — Link clients to plans with billing day (`POST /api/contracts`)
3. **Auto-Invoice** — The scheduler generates invoices on each billing cycle
4. **Record Payments** — Payments are received and allocated to invoices (`POST /api/payments`)
5. **Auto-Suspend** — Overdue contracts are suspended per organization rules

### Manual Invoice Generation

```http
POST /api/billing/generate-invoice
Content-Type: application/json

{
  "contract_id": 5
}
```

### Payment Allocation

When recording a payment, allocate it to specific invoices:

```http
POST /api/payments
{
  "client_id": 5,
  "amount": 499.00,
  "payment_method": "transfer"
}
```

Then allocate:

```http
POST /api/payments/:id/allocate
{
  "invoice_id": 42,
  "amount": 499.00
}
```

### Suspension Rules

Configure auto-suspension rules per organization:

```http
POST /api/suspension-rules
{
  "name": "30-day overdue",
  "days_overdue": 30,
  "action": "auto_suspend",
  "grace_period_days": 5
}
```

---

## Quotes Workflow

Quotes are built the same way as invoices: pick a client, add contract /
product / custom line items, and submit everything at once. `quote_number`
is auto-assigned (`QUO-######`, atomic per-organization sequence — same
mechanism as `invoice_number`), and an explicit approval step gates whether
a quote can become an invoice.

1. **Generate the quote** — `POST /api/quotes/generate`
   (`{ client_id, items: [...] }`, mirrors `POST /api/invoices/generate`'s
   flexible format). Each item is `{ type: 'contract'|'product'|'custom', ... }`:
   - `contract` — `{ type: 'contract', contract_id }`, priced at the
     contract's current plan price (`price_override` or the plan's price).
     Unlike invoice generation, this never touches `billing_periods` — a
     quote is only an estimate and may never be accepted.
   - `product` / `custom` — `{ type, description, quantity, unit_price }`
     (the product-vs-custom distinction is a frontend-only label; the
     product catalog lookup that fills in `description`/`unit_price` happens
     client-side against `GET /plans/addons/catalog`).
   The response is the created quote (`status: 'draft'`, `quote_number`
   auto-assigned, `subtotal`/`tax_amount`/`total` computed from the org's
   default tax rate as a **fraction** — `subtotal * tax_rate`, never `* 100`).
   `requirePermission('quotes.create')`.
2. **Add more line items later** (optional) — `POST /api/quotes/:id/items`
   for a single item (`description`, `quantity`, `unit_price`);
   `quote_items.total` is a generated column (`quantity * unit_price`)
   computed by the database. Used by the quote detail page to extend an
   already-created quote; `POST /api/quotes` (plain create, no items) also
   auto-assigns `quote_number` when omitted, for callers that don't need the
   full generate flow.
3. **Approve or reject** — `POST /api/quotes/:id/approve` or
   `POST /api/quotes/:id/reject` (requires `quotes.update`; any user who can
   edit quotes can decide one — there is no separate approval permission).
   Both are lenient: a quote can be approved/rejected from any status,
   including re-deciding an already-accepted or already-rejected quote.
4. **Convert to invoice** — `POST /api/quotes/:id/convert-to-invoice` only
   succeeds once the quote's status is `accepted`; otherwise it returns
   `409 QUOTE_NOT_ACCEPTED`. On success the quote's items are copied to a new
   invoice's `invoice_items` and the invoice is returned.

```http
POST /api/quotes/generate
{
  "client_id": 5,
  "items": [
    { "type": "contract", "contract_id": 12 },
    { "type": "custom", "description": "Site survey", "quantity": 1, "unit_price": 500 }
  ]
}
```

```http
POST /api/quotes/42/approve
```

```http
POST /api/quotes/42/convert-to-invoice
```

---

## CFDI 4.0 Workflow (Mexico)

FireISP supports Mexican fiscal compliance with CFDI 4.0 electronic invoicing.

### Prerequisites

1. **Upload CSD Certificate** — `POST /api/csd-certificates` (PFX file + password)
2. **Configure PAC Provider** — `POST /api/pac-providers` (Finkok or SW Sapien)
3. **Set Organization MX Profile** — RFC, régimen fiscal, domicilio fiscal

### CFDI Generation Flow

1. **Create Invoice** — Standard invoice generation (see Billing Workflow)
2. **Stamp CFDI** — `POST /api/cfdi/stamp` with the invoice ID
3. **Download XML/PDF** — `GET /api/pdf/cfdi/:id` or `GET /api/cfdi-documents/:id`
4. **Cancel CFDI** — `POST /api/cfdi/cancel` with motivo and optional folio_sustitucion

### SAT Catalogs

Read-only endpoints for Mexican SAT catalog values:

```http
GET /api/sat-catalogs/regimen-fiscal
GET /api/sat-catalogs/uso-cfdi
GET /api/sat-catalogs/forma-pago
GET /api/sat-catalogs/metodo-pago
GET /api/sat-catalogs/tipo-comprobante
GET /api/sat-catalogs/moneda
GET /api/sat-catalogs/clave-prod-serv?search=internet
GET /api/sat-catalogs/clave-unidad?search=servicio
```

### Factura Pública vs Individual CFDI

- Contracts with `facturar = TRUE` → Individual CFDI per client
- Contracts with `facturar = FALSE` → Aggregated into a factura pública

---

## File Uploads

Files are uploaded via multipart/form-data and scoped to entities (clients, devices, tickets, organizations):

```http
POST /api/files
Content-Type: multipart/form-data

entity_type=clients
entity_id=5
file=@document.pdf
```

File uploads are rate-limited to 30 requests per 15 minutes (upload tier).

---

## CSV / PDF Exports

### CSV Exports

```http
GET /api/export/invoices?date_from=2025-01-01&date_to=2025-01-31
GET /api/export/clients
GET /api/export/contracts
GET /api/export/payments
```

### PDF Downloads

```http
GET /api/pdf/invoices/:id
GET /api/pdf/credit-notes/:id
GET /api/pdf/quotes/:id
GET /api/pdf/cfdi/:id
```

Export endpoints are rate-limited to 20 requests per 15 minutes.

---

## OpenAPI / Swagger

Interactive API documentation is available at:

- **Swagger UI**: `GET /api/docs`
- **OpenAPI JSON spec**: `GET /api/docs/openapi.json`

The spec is auto-generated from route definitions and validation schema files. Use it to explore all endpoints, view request/response schemas, and test API calls directly from the browser.
