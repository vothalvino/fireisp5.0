# WhatsApp Customer Support — Design Spec (DRAFT for review)

Status: **proposed, pre-implementation.** This documents the identity/security
foundation and the phased build. Nothing here is built yet.

## 1. Principle: the WhatsApp number *identifies*, it does not *authenticate*

Meta guarantees the sender controls that phone number. It does **not** prove the
sender is the account holder (SIM swap, recycled number, a family member's phone,
a stale/shared `clients.phone`). Therefore:

- A number match to `clients.phone` is **only** a server-side hint used to decide
  *where to send a verification code*. It never grants access and is never echoed
  back ("yes, you're a customer") — that would be a customer-enumeration oracle.
- Access to anything account-specific requires a **binding step** that proves
  account ownership through a channel the system already trusts.
- After binding, high-impact actions still require a per-action **step-up**
  confirmation; the most dangerous actions are not available in chat at all.

Downstream of a resolved `clientId` everything already exists (balance, tickets,
AI chat, contract data) — see `docs`/the inventory. The net-new work is purely
*getting to a trustworthy `clientId` from a phone number*.

## 2. Identity model

### 2.1 Binding (one-time, links a phone ↔ client)

Two paths; an org can enable either or both.

**A. Portal linking code (strongest).** In the existing subscriber portal
(`portalAuthService`, email+password, already lockout-protected) the client opens
"Connect WhatsApp", which mints a short-lived numeric code + a `wa.me` deep link.
The client sends the code to the bot once. Proof rides on the real portal auth.

**B. Email OTP (broader coverage).** Portal access is admin-enabled, so many
clients have no portal password. Fallback: the client states their **account
email**; the bot sends a 6-digit code **to that email** (a *different* channel
from the WhatsApp thread — that is what makes it a second factor), valid ~10 min;
on success the number is bound.

Both converge on: insert a `whatsapp_links` row binding `phone_e164 → client_id`.

**Never** used for binding: SMS OTP to the same number (same-channel, no second
factor), or a bare `clients.phone` match (weak identifier).

### 2.2 What a bound number can do without re-proving

A bound number gets a lightweight session (recent-activity window). Tier-1
read-only actions need only the binding. Tier-2 actions need a **step-up**: a
fresh, single-purpose confirmation (e.g. "Reply CONFIRM to change the Wi-Fi
password") — bounded in time, one action per confirmation.

### 2.3 Unbinding / revocation

- Client: "unlink" command → soft-delete the `whatsapp_links` row.
- Staff: an admin action on the client page.
- Automatic: if `clients.phone` changes, or the client's portal password is
  reset, existing links for that client are invalidated (re-bind required).

## 3. Schema (net-new)

```
-- Normalized, unique phone identity for messaging. One row per (org, e164).
CREATE TABLE whatsapp_links (
  id                BIGINT UNSIGNED PK,
  organization_id   BIGINT UNSIGNED NOT NULL,          -- FK organizations
  client_id         BIGINT UNSIGNED NOT NULL,          -- FK clients
  phone_e164        VARCHAR(20)  NOT NULL,             -- normalized E.164
  bound_via         ENUM('portal','email_otp','staff') NOT NULL,
  bound_at          DATETIME NOT NULL,
  last_seen_at      DATETIME NULL,
  status            ENUM('active','revoked') NOT NULL DEFAULT 'active',
  deleted_at        DATETIME NULL,
  UNIQUE (organization_id, phone_e164, deleted_at)      -- one active bind per number per org
);

-- Short-lived verification codes (linking OTP + step-up challenges).
CREATE TABLE whatsapp_verifications (
  id              BIGINT UNSIGNED PK,
  organization_id BIGINT UNSIGNED NOT NULL,
  phone_e164      VARCHAR(20) NOT NULL,
  purpose         ENUM('link_portal','link_email','stepup') NOT NULL,
  client_id       BIGINT UNSIGNED NULL,                 -- target once known
  code_hash       CHAR(64) NOT NULL,                    -- sha256(code+pepper), NEVER plaintext
  channel         ENUM('email','portal') NOT NULL,      -- where the code was sent
  expires_at      DATETIME NOT NULL,
  consumed_at     DATETIME NULL,
  attempts        INT NOT NULL DEFAULT 0,               -- wrong-code tries
  created_at      DATETIME NOT NULL
);

-- Inbound message log (audit + idempotency, mirrors webhook_events discipline).
CREATE TABLE whatsapp_inbound_messages (
  id                  BIGINT UNSIGNED PK,
  organization_id     BIGINT UNSIGNED NULL,             -- resolved once bound
  provider_message_id VARCHAR(255) NOT NULL,            -- Meta/Twilio id
  phone_e164          VARCHAR(20) NOT NULL,
  body                TEXT,
  received_at         DATETIME NOT NULL,
  UNIQUE (provider_message_id)                          -- dedup redeliveries
);
```

- `phone_e164` normalized to E.164 on ingest; `clients.phone` stays free-form but
  a normalized lookup (or a generated/normalized column) maps it for the
  "where to send a code" hint.
- `code_hash` only — codes are never stored or logged in plaintext (same
  discipline as `portal_reset_token_hash`).

## 4. Inbound webhook (net-new — no messaging inbound exists today)

`POST /api/v1/whatsapp/webhook` — **public**, authenticated by the provider's
signature (Meta `X-Hub-Signature-256` HMAC, or Twilio `X-Twilio-Signature`).
**Fail closed**, mirroring the payment-webhook hardening (#509):

- No/invalid signature → **401**, never processed.
- Signing secret not configured → **503** (not silently trusted).
- Malformed / non-message payload → **400** before any processing.
- Dedup on `provider_message_id` (redeliveries are routine).
- Meta's `GET` verification challenge handled separately.

## 5. Abuse / rate limits

- Per-`phone_e164` verification budget (fixed-window, mirror
  `checkBulkEmailDailyBudget` / portal lockout): N code requests/hour, lock after
  K wrong step-up/OTP attempts (copy the `portal_login_attempts` DB-lockout).
- Per-IP webhook limiter (reuse `makeLimiter` / `webhookLimiter`).
- No enumeration: identical bot response whether or not a number/email is on file.

## 6. Capabilities by tier

| Tier | Requires | Actions |
|---|---|---|
| 0 | nothing | plans/pricing, coverage by address, how to pay, hours, FAQ, **area-outage report**, "talk to a human" (ticket/callback) |
| 1 | bound number | **balance & due date** (`clientBalanceService`), last/next invoice status, current plan/speed, contract status. Invoice/**CFDI copies emailed**, not in chat |
| 2 | bound + step-up | **report a problem on a chosen contract** (`diagnosticEngineService` + `aiReplyService`/`supportConversationService`, already `whatsapp`-aware → ticket), **change Wi-Fi password**, **pay now** (secure link), technician visit/reschedule, proof-of-payment upload, CFDI request |

**Out of WhatsApp entirely** (portal or human only): change account email/phone,
change fiscal data (RFC/CSD), cancel service, reveal any current password or card
data.

### 6.1 Multi-contract

One client → many contracts (`contracts.client_id` non-unique, identified by
numeric `id`, no `contract_number`). Any contract-specific action (report a
problem, change Wi-Fi password) **must present a contract picker** when the
client has >1 active contract — the portal's "first active contract" shortcut is
not safe to inherit for writes.

### 6.2 Wi-Fi password (the sharp edge)

- Two secrets: **PPPoE** (`radius.password`) vs the home **Wi-Fi PSK**
  (`onu_omci_configs.wifi_password_encrypted`). Customers mean the PSK.
- **Set a new one; never reveal the current one** in chat.
- Requires step-up **and** an email notification that it changed (so a hijacker
  can't change it silently).
- Neither existing change path sends a CoA/reconnect; expect a brief drop and
  say so. Reuse `portalServiceRequestService` (approval) or auto-apply post-step-up.

## 7. Phased build

- **Phase 0 — foundation (this spec):** schema, phone normalization, inbound
  webhook (fail-closed + dedup), rate/lockout primitives. No customer-visible
  capability yet; testable with a signed sandbox payload.
- **Phase 1 — identify + read-only:** binding (portal + email OTP), Tier-0 +
  Tier-1 (balance, plan/status, report-a-problem → ticket). Reuses the AI stack.
- **Phase 2 — write actions:** pay-now link, Wi-Fi password change (step-up +
  notify), technician scheduling, proof-of-payment, CFDI request. Multi-contract
  picker.

Each phase = its own PR with the full local gate + adversarial review on the
identity/webhook/billing pieces.

## 8. Threat model (what each control defends)

| Threat | Control |
|---|---|
| Attacker texts from a random number | Binding required; no data to unbound numbers |
| Attacker knows victim's number (spoof/SIM-swap) | Binding needs portal login OR email OTP (second channel), not number match |
| Enumeration ("is X a customer?") | Uniform responses; number match never surfaced |
| Hijacked WhatsApp thread | Step-up per sensitive action; email notify on Wi-Fi change; dangerous actions excluded |
| Webhook forgery / replay | Signature verify (fail-closed) + `provider_message_id` dedup |
| Code brute-force | Hashed codes, short expiry, attempt lockout, per-phone budget |
| Cross-tenant leak | Everything org-scoped (`organization_id` on every new table + query) |
| Secret leakage into chat history | Never reveal passwords/cards; set-don't-show for Wi-Fi; copies via email |

## 9. Implementation notes (as built — PR 1: foundation + binding)

Deltas from the design above, decided during implementation + adversarial review:

- **Binding uniqueness is install-wide, not per-org.** The inbound webhook is a
  single endpoint with no org context, so a sender number must resolve to
  exactly one client. `whatsapp_links.active_phone` (VIRTUAL) is UNIQUE globally;
  `organization_id` is retained as data. Per-org WhatsApp business numbers (route
  by the receiving number) is a later enhancement — `to_number` is already stored.
- **Portal codes are matched phone-agnostically by hash; on a code collision
  across two clients we refuse to bind** (`ambiguous`) rather than guess — no
  wrong binding is ever created (both codes self-heal on expiry). Portal-code
  brute force is bounded by the per-phone inbound throttle (all guesses arrive as
  provider-signed webhooks) + short TTL + 8-digit space.
- **Codes are redacted before the inbound body is persisted** (`redactSecrets`
  masks 4+ digit runs) — honors §3's "never store codes in plaintext".
- **Webhook acks 200 immediately, then processes async.** The bot + a live
  outbound reply can take up to 15s; blocking the provider's delivery window
  risks a redelivery storm. Dedup on `(provider, provider_message_id)` makes any
  redelivery a no-op.
- **Two OTP budgets:** per-sender-phone (anti-flood) AND per-target-client
  (anti-inbox-bomb by a number-cycling attacker). Portal link-code minting is
  capped per client.
- **Twilio behind a proxy:** signature URL reconstruction trusts
  `X-Forwarded-Host/Proto` unless `WHATSAPP_WEBHOOK_PUBLIC_URL` is set — this is
  availability only (never a signature bypass), but set it in production.
- **Meta config coherence:** inbound is detected from `WHATSAPP_APP_SECRET`;
  outbound needs `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN`. A startup
  warning fires if only the inbound half is configured.
- **Known limitation:** a client whose email is shared across orgs (or duplicated)
  can't link via email OTP (we send only on a unique match) — they use the portal
  linking code instead.
- **Bot copy is English** (in a `MESSAGES` map for easy localization later);
  Spanish/i18n is a follow-up.
