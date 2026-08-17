# FireISP 5.0 — Privacy & PII Inventory (LFPDPPP MX / GDPR)

> **Audience:** Operators, compliance officers, legal counsel.
> This document is a working inventory of personal-data categories held by
> FireISP. Operators must verify it against their enabled modules, free-text
> fields, integrations, logs, replicas, backups and exports; it is not a claim
> that every deployed personal-data element or legal basis is automatically
> identified.
>
> **Mexican operators** are subject to the *Ley Federal de Protección de Datos
> Personales en Posesión de los Particulares* (LFPDPPP) and its *Reglamento*.
> **EU / EEA operators** are subject to GDPR (Regulation EU 2016/679).
> Primary Mexican source: [current LFPDPPP text](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf).

---

## Table of Contents

- [Data Controller](#data-controller)
- [Lawful Basis Summary](#lawful-basis-summary)
- [PII Field Inventory](#pii-field-inventory)
- [AI Reply Assistant — prompt-forwarding notice](#ai-reply-assistant--prompt-forwarding-notice)
- [Data-Subject Access Request (DSAR) procedure](#data-subject-access-request-dsar-procedure)
- [Erasure procedure](#erasure-procedure)
- [Retention periods](#retention-periods)
- [Third-party data processors](#third-party-data-processors)
- [Security measures](#security-measures)

---

## Data Controller

The data controller is the **ISP operator** who deploys FireISP.  FireISP is
software — the legal entity responsible for LFPDPPP / GDPR compliance is the
ISP company, not the FireISP project itself.

---

## Lawful Basis Summary

| Category | LFPDPPP basis | GDPR basis (if applicable) |
|---|---|---|
| Subscriber identity & contact data | Consent and/or a specific Article 9 exception, commonly Article 9(IV) for rights and obligations arising from the legal relationship | Art. 6(1)(b) — performance of contract |
| Billing & invoicing data | Article 9(I) where a legal provision requires it and/or Article 9(IV) for the legal relationship | Art. 6(1)(b) + Art. 6(1)(c) |
| Subscriber-session logs (assigned IP, MAC, RADIUS session data) | Consent or a documented Article 9 exception; identify separately any current telecom duty that applies to the operator's service | Operator must determine the applicable EU member-state basis; GDPR alone is not a blanket traffic-data retention mandate |
| Privacy-minimal CGNAT attribution bindings | Consent or a specific Article 9 exception for a separately documented, necessary and proportionate attribution purpose; the LMTR does not expressly enumerate CGNAT address/port bindings, and the `MX` locale supplies no automatic basis | Operator-specific assessment required; minimize fields and restrict access and retention |
| CFDI / SAT fiscal data | Legal obligation (CFF Art. 29; CFDI 4.0) | Art. 6(1)(c) |
| Ticket / support data | Consent and/or Article 9(IV) legal-relationship exception | Art. 6(1)(b) |
| 2FA / TOTP secrets | Consent and/or Article 9(IV), with security safeguards | Art. 6(1)(b) + Art. 32 GDPR |

LFPDPPP does not use GDPR's standalone “contractual necessity” or “legitimate
interest” labels as legal bases. The controller must identify consent or the
exact Article 9 exception and still comply with the purpose, quality,
proportionality, information, security and suppression duties in Articles
5 and 10–12. Article 16 concerns delivery of the privacy notice; it is not the
contract basis.

---

## PII Field Inventory

### Table: `clients`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `name` | Full legal name | Consent / Article 9(IV) legal relationship | Operator policy: life of contract + documented prescription period |
| `email` | Primary email address | Consent / Article 9(IV) legal relationship | Operator policy: life of contract + documented prescription period |
| `phone` | Phone number | Consent / Article 9(IV) legal relationship | Operator policy: life of contract + documented prescription period |
| `tax_id` | RFC (MX) or tax identification number | Article 9(I) when required by fiscal law | Operator tax-record schedule |
| `address`, `city`, `state`, `zip_code`, `country` | Physical address | Consent / Article 9(I) or (IV), as applicable | Operator policy tied to the documented purpose |
| `notes` | Free-text notes entered by operator | Consent or a documented Article 9 exception | Delete when no longer necessary for the stated purpose |
| `client_type` | personal / company | Consent / Article 9(IV) legal relationship | Operator policy tied to the legal relationship |

### Table: `contacts`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `name` | Contact person name | Consent / Article 9(IV), as applicable | Purpose-based operator policy |
| `email` | Contact email | Consent / Article 9(IV), as applicable | Purpose-based operator policy |
| `phone` | Contact phone | Consent / Article 9(IV), as applicable | Purpose-based operator policy |

### Table: `client_mx_profiles`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `rfc` | RFC (Mexican tax ID) | Article 9(I) when required by fiscal law | Operator tax-record schedule |
| `curp` | CURP (national personal identifier) | Only a cited specific legal/CFDI rule or other valid basis; ordinary CFDI 4.0 does not make CURP universally mandatory | Purpose-specific; minimize and delete when no longer required |
| `regimen_fiscal` | SAT fiscal regime code | Article 9(I) when required by fiscal law | Operator tax-record schedule |
| `uso_cfdi` | SAT CFDI use code | Article 9(I) when required by fiscal law | Operator tax-record schedule |
| `zip_code` | Fiscal ZIP code | Article 9(I) when required by fiscal law | Operator tax-record schedule |

### Table: `contracts`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `monthly_price` | Agreed service price | Article 9(IV) legal relationship and Article 9(I) where required | Operator prescription/tax schedule |
| `start_date`, `end_date` | Service period | Article 9(IV) legal relationship and Article 9(I) where required | Operator prescription/tax schedule |

### Table: `invoices`

See the [current CFF, Article 30](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf);
the exact retention trigger and special case must be selected with tax counsel.

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| All columns | Fiscal invoice data required by SAT | Legal obligation (CFF) | Operator tax schedule; CFF Article 30 generally uses 5 years from the related filing/due date, with special longer cases |

### Table: `cfdi_documents`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| All columns | CFDI XML + UUID + PAC response | Legal obligation (CFF Art. 30) | Same operator tax-record schedule; do not calculate from stamp date alone |

### Table: `payments`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `amount`, `payment_method`, `paid_at` | Payment record | Article 9(IV) legal relationship and Article 9(I) where required | Operator prescription/tax schedule |

### Table: `connection_logs`

This table is a mutable current/final session projection. Supported application
ingest updates one row per lifecycle; it is not an immutable row for every
RADIUS heartbeat.

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `framed_ip`, `ip_address`, IPv6 fields | Address assigned to the subscriber session | Contract/network operations; legal obligation only when applicable | **24 months by default**; confirm scope with counsel |
| `calling_station_id` | NAS-reported subscriber MAC/circuit identity | Network operations/security | 24 months with the session by default |
| `username`, `acct_session_id` | PPPoE/RADIUS subscriber and session identifiers | Contract/network operations; legal obligation only when applicable | **24 months by default** |
| `event_at`, `session_duration`, `terminate_cause` | Session timing and closure metadata | Contract/network operations; legal obligation only when applicable | **24 months by default** |
| `bytes_in`, `bytes_out` | Cumulative session volume, not content or destination history | Network operations/usage accounting | **24 months by default** |

When the assigned address is a direct public IPv4 address, public IP plus an
exact UTC instant can identify a unique, evidence-bounded session without
collecting a source port or protocol. The lower boundary requires both the
first exact-IP lifecycle event time and its receipt; the closed or active upper
boundary requires both the relevant accounting event time and its receipt, with
active evidence still fresh. Shared-CGNAT attribution additionally needs the
translated source port and protocol. Neither result identifies the human or
records the destination/action.

### Table: `radius_accounting_events`

| Column group | Description | Lawful basis | Retention |
|---|---|---|---|
| Subscriber/session, NAS, timing, assigned address, counters | Selected normalized application-level lifecycle evidence for Start, the first Interim transition, Stop, and a later corrected final Stop when applicable; not raw packets or every routine Interim heartbeat | Same documented basis as the associated subscriber session | **24 calendar months by default** |
| Event key and integrity hash | Replay protection and consistency checking; not tamper-proof against a privileged database administrator and not a complete statutory vault | Security/accountability | Same as the accounting event |

### Table: `radius_accounting_usage_daily`

| Column group | Description | Lawful basis | Retention |
|---|---|---|---|
| UTC day, subscriber/session, monotonic counter deltas | Operational usage rollup populated by supported application ingest; a cross-midnight interval is assigned to its normalized event day, not split exactly | Network operations/usage accounting | **24 calendar months by default** |
| Completeness and anomaly fields | Flags a non-zero baseline, late/reset counter, or UTC-boundary estimate so exact-use consumers can fail closed | Security/accountability | Same as the rollup row |

Direct SQL writes to `connection_logs` do not populate this usage rollup. A
missing rollup is not evidence of zero traffic, and an incomplete row must not
be treated as exact billing, FUP, or legal attribution.

### Table: `cgnat_attribution_bindings` (operator/counsel configured)

| Column group | Description | Lawful basis | Retention |
|---|---|---|---|
| Private and translated public source tuple/port range, protocol, exact UTC allocation interval | Minimum NAT binding needed to resolve a public source tuple and instant to an access session | Separately documented operator purpose; not an automatic LMTR Article 183 requirement | Operator/counsel-approved **1–24 calendar-month** ordinary schedule; 24 months is both the product default and hard maximum, except for an active scoped hold |
| Required canonical `session_instance_id` from tenant RADIUS ingest, plus subscriber/account correlation | Anchors every allocate/release event to one same-organization subscription/access lifecycle; reused private addresses and optional collector hints are not identity authority, and the result does not identify the human or prove an action | Same documented attribution purpose | Same approved binding schedule or scoped preservation hold |
| CGNAT gateway, pool/realm, collector identity and source event key | Coverage, provenance and replay-control metadata | Security/accountability | Same approved binding schedule |

The schema and API intentionally have no destination address/port, URL, domain,
DNS, packet payload, application content, or browsing-history field. Do not put
those values into free-form identifiers. A unique tuple/time match attributes a
subscriber account and access session—not an actual person, destination, or act.
This requires the CGNAT to assign each public source IP/port/protocol tuple
exclusively at a given instant. A translator that reuses it across subscribers
and needs the remote destination for disambiguation is unsupported in this mode;
do not expand the record to include destinations as a workaround.

An audited data-subject access export may enumerate only bindings and event
records already linked to the exact same-organization client through client,
contract, or access-session identity. It requires the privacy-response and
connection-export permissions. This is not a public-address/port lookup and
does not use or replace the government-request case gate.

### Tables: `cgnat_exporter_configs` and `cgnat_binding_events`

| Column group | Description | Lawful basis | Retention |
|---|---|---|---|
| Exporter/NAT instance/pool/realm, required/enabled state, purpose reference, exclusivity attestation, reconciled-empty-baseline reference and approver | Operator configuration and accountability for complete, source-only coverage; v1 cannot import a nonempty historical snapshot or attribute pre-baseline allocations | Security/accountability tied to the approved attribution purpose | Configuration lifecycle plus the operator's accountability schedule |
| Allocate/release event identity, sequence/loss/clock evidence and integrity hash | Append-only lifecycle provenance for the corresponding binding; raw device time is corrected by its declared offset and only corrected time minus uncertainty advances the certain feed horizon; v1 has no heartbeat/checkpoint, so quiet open mappings become stale rather than remaining continuously attributable | Same approved attribution purpose and security/accountability | Same approved binding schedule, subject to a scoped preservation hold |

A device or normalizer boot transition does not inherit continuity. The covered
pool must be drained/reconciled to a new empty baseline and registered as a new
versioned exporter identity/configuration epoch; old or interrupted evidence is
not made healthy by reusing or changing a boot identifier.

### Table: `ip_attribution_case_evidence`

| Column group | Description | Lawful basis | Retention |
|---|---|---|---|
| Government-request case, direct-session or CGNAT-binding reference, exact authorized query and evidence hash | Restricted preservation link created by an approved case-bound lookup | Validated authority request and operator legal review | Preserved while its explicit hold is active; ordinary approved deletion resumes after audited release |
| Pin/release actor, time and release reason | Hold lifecycle and accountability metadata | Security/accountability | Operator legal-case schedule |

### Table: `ip_assignments`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `ip_address` | Assigned IP (static or dynamic) | Contract/network operations; legal obligation only when applicable | No automated table-specific purge; operator schedule required |
| `assigned_at`, `released_at` | Assignment period | Contract/network operations; legal obligation only when applicable | No automated table-specific purge; operator schedule required |

### Table: `tickets`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `subject`, `description` | Support ticket content | Consent / Article 9(IV), as applicable | Purpose-based operator policy |

### Table: `ai_reply_logs` (AI Reply Assistant)

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `draft_text` | AI-generated draft reply for the client's ticket | Consent / Article 9(IV), as applicable | Purpose-based operator policy |
| `final_text` | Edited or approved reply sent to the client | Consent / Article 9(IV), as applicable | Purpose-based operator policy |
| `action` | Disposition: proposed / sent / edited / discarded / auto_sent | Same documented support purpose | Purpose-based operator policy |
| `classification`, `confidence` | Issue category + model confidence score | Consent or a documented Article 9 exception | Delete when no longer necessary |

> **Prompt-data classification:** `context_snapshot` and `prompt_hash` may be
> personal data when their contents or linkability identify a person directly or
> indirectly (LFPDPPP Article 2(V)). Classify the actual deployment and include
> responsive values in an ARCO export when they are personal data.

### Table: `users` (operator/admin accounts, not end-subscribers)

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `name`, `email` | Operator identity | Employment / B2B contract | Active + 1 year |
| `password_hash` | Bcrypt hash | Security | Active only |
| `totp_secret`, `totp_backup_codes` | 2FA credentials | Security | Active only; zeroed on 2FA disable |
| `last_login_at`, `failed_attempts` | Security audit | Consent or a documented Article 9 exception | Operator security-retention policy |

### Table: `audit_logs`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `user_id`, `ip_address`, `action`, `entity_type`, `entity_id` | Security audit trail | Specific legal duty, consent, or documented Article 9 exception | Operator accountability/prescription policy |

---

## AI Reply Assistant — prompt-forwarding notice

When the **AI Reply Assistant** is enabled (`ai_policies.enabled = 1`), FireISP
constructs a prompt for each inbound support ticket and sends it to the
configured LLM provider.  The prompt includes:

- The ticket subject and description (may contain client-authored PII).
- A network context snapshot (device names, topology path, active outages).
- The relevant section of the operator's phrase library (no client PII).

### PII in prompts

| `redact_pii_before_llm` setting | Behaviour |
|---|---|
| **`1` (default, recommended)** | Listed patterns such as IP/MAC addresses, phone numbers, emails and some postal-address forms are replaced with placeholders. Names, RFC/CURP, free text, rare identifiers and indirect identifiers may remain; this is risk reduction, not guaranteed anonymization. |
| `0` (disabled) | The full ticket text, including any PII the client wrote, is forwarded verbatim to the provider. Use only when the configured provider is an on-prem Ollama instance where data does not leave the server. |

### On-prem option

Configuring an **Ollama** provider (`kind = 'ollama'`) can keep inference local
only when the endpoint, host, network path, logging, telemetry and backups are
actually operator-controlled and local. Verify those conditions; the provider
label alone does not establish that no third party receives prompt data.

The opposite end of that scale is **OpenRouter** (`kind = 'openrouter'`), which
routes each request on to a third-party model vendor of your choosing — so
prompt data leaves your infrastructure twice over, and `redact_pii_before_llm`
matters accordingly. Choosing a model in the UI also fetches OpenRouter's public
model catalog from your server; that request carries no API key and nothing
identifying the install, and it is made only while an admin has the provider form
open.

### Operator obligation

Operators must:

1. Disclose the use of AI drafting (and any external LLM provider) in their
   **privacy notice** to subscribers.
2. Sign a **Data Processing Agreement (DPA)** with every external LLM provider
   used (OpenAI, Azure OpenAI, Anthropic, Google).
3. When GDPR applies, determine and document the actual Chapter V transfer
   mechanism for every external provider and onward recipient. Pattern
   redaction is risk reduction, not anonymization, and does not by itself remove
   GDPR transfer requirements. A genuinely operator-controlled local Ollama
   path may avoid an external transfer only after its endpoint, network,
   telemetry, logs, backups, and support access are verified.

---

## Data-Subject Access Request (DSAR) procedure

### LFPDPPP (MX) — *Solicitud de Acceso, Rectificación, Cancelación u Oposición* (ARCO)

1. Capture the elements required by LFPDPPP Article 28, including the holder's
   name, address or other means for the response, identity/representation
   documents, a clear description of the rights and data involved, and any
   additional elements that facilitate locating the data.

2. Under Articles 2(VIII) and 31, notify the determination within **20 business
   days**. If granted, make it effective within the following **15 business
   days**. Article 31 permits one equal extension when justified.

3. Use the FireISP DSAR export as a starting dataset:

   ```bash
   # Via API — admin credential required
   curl -X GET "https://your-fireisp.domain/api/v1/dsar/clients/<client_id>" \
     -H "Authorization: Bearer <admin_token>" \
     -H "X-Org-Id: <org_id>"
   ```

   The current endpoint includes selected client, contact, MX-profile, contract,
   invoice, payment, ticket, connection-log, IP-assignment and AI-reply rows,
   with implementation caps on some collections. It is **not a complete ARCO
   fulfillment by itself**. Supplement it with every responsive page/record,
   including identifiable `radius_accounting_events`,
   `cgnat_attribution_bindings`, `cgnat_binding_events` and appropriately
   restricted `ip_attribution_case_evidence`,
   prompt/context data, audit data, integrations, exports and other storage.

4. Deliver the JSON export to the data subject (encrypted email or secure download).

5. Record the restricted case and completion evidence in `dsar_requests`; do not
   place requester or client identifiers in source-controlled documentation.

### GDPR (EU) — Data Subject Access Request

1. Data subject submits a request (email, web form, or in writing). No specific
   format is generally required. Requests are ordinarily handled without a fee,
   subject to the limited GDPR Article 12(5) rules for manifestly unfounded or
   excessive requests; verify identity proportionately.

2. Respond without undue delay and in any event within **one month** under GDPR
   Article 12(3). Where permitted by complexity and number of requests, the
   period may be extended by two further months, but the person must be told of
   the extension and reasons within the first month.

3. Use the same DSAR export tool as above.

4. If the data subject requests **erasure** (GDPR Art. 17), follow the
   [Erasure procedure](#erasure-procedure) below.

5. Record the restricted case and completion evidence in `dsar_requests`.

---

## Erasure procedure

### Soft-delete (default)

FireISP uses soft-delete (`deleted_at IS NOT NULL`) for several tables.
Soft-delete only hides a row from normal APIs; it is not LFPDPPP blocking or
suppression and is not itself a legal basis for indefinite retention. Apply the
approved purpose/legal-hold schedule, block where required, then suppress.

### Full erasure (LFPDPPP right to cancellation / GDPR right to erasure)

> **Important:** Some data cannot be erased due to legal obligations:
> - Fiscal records follow the operator's CFF Article 30 schedule. The general
>   rule is commonly five years from the related filing/due date, with special
>   longer or event-dependent cases; it is not a blanket ten years from stamp.
> - Covered LMTR Article 183 communications metadata must be retained for two
>   consecutive 12-month periods. This does not automatically make CGNAT
>   bindings a mandatory record for every fixed-broadband service. Confirm the
>   scope and any legal hold with counsel before erasure.

Do not use a short generic SQL script as proof of complete cancellation. Make a
record-by-record determination under Articles 24–25, then use a reviewed,
tested runbook that covers direct and indirect identifiers in client/contact/MX
profiles, tickets and AI context, IP assignments, `connection_logs`,
`radius_accounting_events`, `cgnat_attribution_bindings`,
`cgnat_binding_events`, `ip_attribution_case_evidence`, audit/legal holds,
integrations, queues, exports, replicas and backups. Preserve only records
covered by a documented exception or hold, verify suppression after the hold
expires, record the action in `dsar_requests`, and communicate the result.

---

## Retention periods

| Data category | Retention period | Trigger for deletion |
|---|---|---|
| Client PII (name, email, address) | Operator policy tied to purpose and applicable prescription | End of documented purpose/hold, then suppression |
| Fiscal / invoicing data | Operator CFF Article 30 schedule; generally 5 years with special cases | Calculated from the applicable filing/due/event, not invoice date alone |
| CFDI XML documents | Same reviewed fiscal-record schedule | Applicable tax-record trigger |
| RADIUS subscriber sessions and accounting evidence | 24 months by default | Rolling period, unless a valid legal hold applies |
| Privacy-minimal CGNAT bindings and lifecycle events | 24 calendar months by product default; operator/counsel must approve the installation-wide period for every enabled tenant because locale alone supplies no legal basis. Divergent tenant schedules require separate deployments until per-organization retention exists | For closed bindings, measured from authoritative release; only specifically held evidence is preserved beyond it. Alert/reconcile missing releases so open rows do not become silently indefinite |
| IP-attribution case evidence | Case/hold schedule | Explicit audited hold release, then the approved deletion/suppression process |
| Operator audit logs | Operator accountability/prescription policy | End of documented purpose/hold |
| 2FA secrets | Active account only | Account deactivation |
| Backups | Operator-configured by target. The local default is file-count based (seven files), while remote retention depends on the bucket/provider lifecycle | Verified local cleanup plus remote provider lifecycle; reconcile legal holds and deletion propagation |
| AI reply log draft/final text | Purpose-based operator policy | End of documented support purpose |

---

## Third-party data processors

| Processor | Purpose | Data transferred | DPA / agreement |
|---|---|---|---|
| PAC provider (for example Finkok) | CFDI stamping | RFC, tax_id, invoice amounts | Applicable processor/service agreement; validate current registration duties with counsel |
| SMTP provider (Nodemailer + any relay) | Transactional email | Email address, name | Data processing agreement required |
| Sentry (optional) | Error monitoring | Sanitized stack traces and diagnostic context. FireISP suppresses request bodies, cookies, authorization headers, query strings and full URLs, and applies a fail-closed event scrubber; remaining stack/context text can still contain indirect identifiers | Sentry DPA, deployment-specific retention/access controls, and regression-tested scrubbing |
| AWS S3 / Cloudflare R2 (optional backup) | Database backups | All database data; at-rest encryption, keys, region, lifecycle, and support access depend on the actual bucket/provider configuration and must be verified | AWS DPA / Cloudflare DPA plus deployment evidence |
| Stripe / Conekta (optional) | Payment processing | Name, email, amount | Their own compliance (PCI-DSS) |
| Twilio (optional) | SMS | Phone number | Twilio DPA |
| **LLM provider** (OpenAI / Azure OpenAI / Anthropic / Google Gemini) | AI reply draft generation | Support ticket text and network context can contain personal data even after pattern redaction | Provider DPA and transfer assessment; minimize and test redaction |
| **Ollama** (on-prem, optional) | AI reply draft generation (self-hosted) | Same prompt data; external transfer depends on actual endpoint, telemetry, logging and network deployment | Verify the complete local deployment boundary |

---

## Security measures

- Passwords stored as bcrypt hashes (cost factor 12).
- Production deployments should expose the API only over TLS 1.2+; the actual
  reverse-proxy/Cloudflare certificate and protocol policy is operator-owned
  and must be verified.
- Database credentials managed via K8s Sealed Secrets (see `docs/secrets-management.md`).
- Pino logger redacts 62 sensitive field paths before writing logs (see `src/utils/logger.js`).
- `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]` on K8s pods.
- RBAC — `clients.view` permission required to access any client data.
- Separate `cgnat_attribution.ingest` and `.manage` permissions protect CGNAT
  collection/configuration. `ip_attribution.view` and `.export` protect legal
  lookup/export, which also require the applicable government-request permission
  and a validated same-organization case. Access/export events are recorded in
  `report_access_logs`.
- IP allowlist available for admin endpoints (`ADMIN_IP_ALLOWLIST`).
- 2FA (TOTP) supported for all operator accounts.
