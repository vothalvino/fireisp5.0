# FireISP 5.0 — Webhook Event Payloads

> All webhook events are dispatched via `POST` to the configured webhook URL.
> Each delivery includes a JSON body with the event type and payload.
>
> **Delivery format:**
> ```json
> {
>   "event": "<event_type>",
>   "timestamp": "2026-04-13T09:00:00.000Z",
>   "data": { ... }
> }
> ```

## Event Types

### `invoice.created`

Fired when a new invoice is generated.

```json
{
  "event": "invoice.created",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 1234,
    "invoice_number": "INV-000042",
    "client_id": 567,
    "total": 599.00,
    "currency": "MXN"
  }
}
```

### `payment.received`

Fired when a payment is recorded.

```json
{
  "event": "payment.received",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 789,
    "client_id": 567,
    "amount": 599.00,
    "currency": "MXN"
  }
}
```

### `contract.suspended`

Fired when a contract is suspended due to overdue payments.

```json
{
  "event": "contract.suspended",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 345,
    "client_id": 567
  }
}
```

### `contract.restored`

Fired when a suspended contract is reconnected.

```json
{
  "event": "contract.restored",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 345,
    "client_id": 567
  }
}
```

### `outage.reported`

Fired when a new network outage is reported.

```json
{
  "event": "outage.reported",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 12,
    "title": "Tower Alpha link down",
    "severity": "critical"
  }
}
```

### `outage.resolved`

Fired when a network outage is resolved.

```json
{
  "event": "outage.resolved",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 12,
    "title": "Tower Alpha link down"
  }
}
```

### `ticket.created`

Fired when a new support ticket is opened.

```json
{
  "event": "ticket.created",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 456,
    "subject": "Internet connection slow",
    "client_id": 567
  }
}
```

### `device.offline`

Fired when a monitored network device goes offline.

```json
{
  "event": "device.offline",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 89,
    "name": "AP-Tower-Bravo-01",
    "ip_address": "10.0.1.50"
  }
}
```

### `device.online`

Fired when a previously offline device comes back online.

```json
{
  "event": "device.online",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "id": 89,
    "name": "AP-Tower-Bravo-01",
    "ip_address": "10.0.1.50"
  }
}
```

### `alert.triggered`

Fired when a monitoring alert rule fires (e.g., high CPU, packet loss).

```json
{
  "event": "alert.triggered",
  "timestamp": "2026-04-13T09:00:00.000Z",
  "data": {
    "alert_rule_id": 7,
    "device_id": 89,
    "metric": "cpu_usage",
    "operator": ">",
    "threshold": 90,
    "actual_value": 95.3,
    "severity": "warning"
  }
}
```

## Configuring Webhooks

Register webhook endpoints via the API:

```bash
curl -X POST /api/v1/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.example.com/webhook",
    "events": ["invoice.created", "payment.received", "contract.suspended"],
    "secret": "your-webhook-signing-secret"
  }'
```

Webhook deliveries are logged in the `webhook_deliveries` table. Failed deliveries are retried automatically using exponential backoff.

## Retry Policy

When a delivery fails (non-2xx response or network error), FireISP schedules automatic retries using **full-jitter exponential backoff**.

| Attempt | Base delay window |
|---------|-------------------|
| 1 | Immediate (synchronous with the triggering event) |
| 2 | 0 – 10 s |
| 3 | 0 – 20 s |
| 4 | 0 – 40 s |
| 5 | 0 – 80 s |
| n | 0 – min(3 600, 10 × 2^(n-1)) s |

The `webhook_retry` scheduled task runs every 5 minutes and processes all deliveries whose `next_retry_at` timestamp has passed.

Once **`max_retries`** (default 5) attempts are exhausted the row is set to `dead_letter` status and no further automatic retries occur.

### Dead-letter management

List dead-letter deliveries for review:

```bash
GET /api/v1/webhooks/dead-letters
```

Manually re-deliver a dead-letter entry (resets to attempt 1):

```bash
POST /api/v1/webhooks/deliveries/:id/redeliver
```

## Verifying Signatures

Each webhook delivery includes an `X-Webhook-Signature` header containing an HMAC-SHA256 digest of the request body using the webhook secret:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}
```
