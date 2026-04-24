# FireISP 5.0 — Privacy & PII Inventory (LFPDPPP MX / GDPR)

> **Audience:** Operators, compliance officers, legal counsel.
> This document lists every personal data element held by FireISP, the lawful
> basis for processing it, its retention period, and how it is erased when a
> data subject exercises their right to erasure.
>
> **Mexican operators** are subject to the *Ley Federal de Protección de Datos
> Personales en Posesión de los Particulares* (LFPDPPP) and its *Reglamento*.
> **EU / EEA operators** are subject to GDPR (Regulation EU 2016/679).

---

## Table of Contents

- [Data Controller](#data-controller)
- [Lawful Basis Summary](#lawful-basis-summary)
- [PII Field Inventory](#pii-field-inventory)
- [Data-Subject Access Request (DSAR) procedure](#data-subject-access-request-dsar-procedure)
- [Erasure procedure](#erasure-procedure)
- [Retention periods](#retention-periods)
- [Third-party data processors](#third-party-data-processors)
- [Security measures](#security-measures)
- [DSAR log](#dsar-log)

---

## Data Controller

The data controller is the **ISP operator** who deploys FireISP.  FireISP is
software — the legal entity responsible for LFPDPPP / GDPR compliance is the
ISP company, not the FireISP project itself.

---

## Lawful Basis Summary

| Category | LFPDPPP basis | GDPR basis (if applicable) |
|---|---|---|
| Subscriber identity & contact data | Contractual necessity (Art. 16 LFPDPPP) | Art. 6(1)(b) — performance of contract |
| Billing & invoicing data | Contractual necessity + legal obligation (SAT fiscal obligations) | Art. 6(1)(b) + Art. 6(1)(c) |
| Network logs (IP, MAC, session data) | Legitimate interest + legal obligation (IFT Norm NOM-184-SCFI; Art. 40 Ley Federal de Telecomunicaciones) | Art. 6(1)(c) — legal obligation (EU e-Privacy Directive) |
| CFDI / SAT fiscal data | Legal obligation (CFF Art. 29; CFDI 4.0) | Art. 6(1)(c) |
| Ticket / support data | Contractual necessity | Art. 6(1)(b) |
| 2FA / TOTP secrets | Security — contractual necessity | Art. 6(1)(b) + Art. 32 GDPR |

---

## PII Field Inventory

### Table: `clients`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `name` | Full legal name | Contractual | Life of contract + 5 years |
| `email` | Primary email address | Contractual | Life of contract + 5 years |
| `phone` | Phone number | Contractual | Life of contract + 5 years |
| `tax_id` | RFC (MX) or tax identification number | Legal obligation | 5 years post-termination |
| `address`, `city`, `state`, `zip_code`, `country` | Physical address | Contractual + billing | Life of contract + 5 years |
| `notes` | Free-text notes entered by operator | Legitimate interest | Life of contract |
| `client_type` | personal / company | Contractual | Life of contract + 5 years |

### Table: `contacts`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `name` | Contact person name | Contractual | Life of client record |
| `email` | Contact email | Contractual | Life of client record |
| `phone` | Contact phone | Contractual | Life of client record |

### Table: `client_mx_profiles`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `rfc` | RFC (Mexican tax ID) | Legal obligation | 5 years post-termination |
| `curp` | CURP (national personal identifier) | Legal obligation (only when required by SAT) | 5 years post-termination |
| `regimen_fiscal` | SAT fiscal regime code | Legal obligation | 5 years post-termination |
| `uso_cfdi` | SAT CFDI use code | Legal obligation | 5 years post-termination |
| `zip_code` | Fiscal ZIP code | Legal obligation | 5 years post-termination |

### Table: `contracts`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `monthly_price` | Agreed service price | Contractual + legal | 5 years post-termination |
| `start_date`, `end_date` | Service period | Contractual + legal | 5 years post-termination |

### Table: `invoices`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| All columns | Fiscal invoice data required by SAT | Legal obligation (CFF) | **10 years** (SAT mandatory) |

### Table: `cfdi_documents`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| All columns | CFDI XML + UUID + PAC response | Legal obligation (CFF Art. 30) | **10 years** |

### Table: `payments`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `amount`, `payment_method`, `paid_at` | Payment record | Contractual + legal | 5 years post-termination |

### Table: `connection_logs`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `ip_address` | Assigned IP address | Legal obligation (IFT) | **2 years** (minimum IFT requirement) |
| `mac_address` | NAS-reported MAC | Legitimate interest | 90 days |
| `username` | PPPoE/RADIUS username | Legal obligation (IFT) | **2 years** |
| `bytes_in`, `bytes_out` | Traffic volume (not content) | Legal obligation (IFT statistical) | **2 years** |

### Table: `ip_assignments`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `ip_address` | Assigned IP (static or dynamic) | Legal obligation (IFT) | **2 years** |
| `assigned_at`, `released_at` | Assignment period | Legal obligation (IFT) | **2 years** |

### Table: `tickets`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `subject`, `description` | Support ticket content | Contractual | Life of contract + 1 year |

### Table: `users` (operator/admin accounts, not end-subscribers)

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `name`, `email` | Operator identity | Employment / B2B contract | Active + 1 year |
| `password_hash` | Bcrypt hash | Security | Active only |
| `totp_secret`, `totp_backup_codes` | 2FA credentials | Security | Active only; zeroed on 2FA disable |
| `last_login_at`, `failed_attempts` | Security audit | Legitimate interest (security) | 90 days rolling |

### Table: `audit_logs`

| Column | Description | Lawful basis | Retention |
|---|---|---|---|
| `user_id`, `ip_address`, `action`, `entity_type`, `entity_id` | Security audit trail | Legal obligation / legitimate interest | **5 years** |

---

## Data-Subject Access Request (DSAR) procedure

### LFPDPPP (MX) — *Solicitud de Acceso, Rectificación, Cancelación u Oposición* (ARCO)

1. Data subject submits a written request (email or postal) including:
   - Full name and identification document.
   - Description of the data or processing to which the request refers.

2. Operator has **20 business days** to respond (Art. 24 LFPDPPP).

3. Use the FireISP DSAR export tool to generate a JSON of all data held:

   ```bash
   # Via API — admin credential required
   curl -X GET "https://your-fireisp.domain/api/v1/dsar/clients/<client_id>" \
     -H "Authorization: Bearer <admin_token>" \
     -H "X-Org-Id: <org_id>"
   ```

   The response includes: client record, contacts, MX profile, contracts,
   invoices, payments, tickets, connection logs (last 500), and IP assignments.

4. Deliver the JSON export to the data subject (encrypted email or secure download).

5. Log the completed request in the [DSAR log](#dsar-log) below.

### GDPR (EU) — Data Subject Access Request

1. Data subject submits a request (email, web form, or in writing).
   No specific format required. No fee allowed.

2. Operator has **30 calendar days** to respond (GDPR Art. 12).

3. Use the same DSAR export tool as above.

4. If the data subject requests **erasure** (GDPR Art. 17), follow the
   [Erasure procedure](#erasure-procedure) below.

5. Log the completed request in the [DSAR log](#dsar-log) below.

---

## Erasure procedure

### Soft-delete (default)

FireISP uses soft-delete (`deleted_at IS NOT NULL`) for clients, contacts,
contracts, invoices, and payments. Soft-deleted rows are invisible to the API
but remain in the database for referential integrity and legal compliance.

### Full erasure (LFPDPPP right to cancellation / GDPR right to erasure)

> **Important:** Some data cannot be erased due to legal obligations:
> - SAT fiscal data (invoices, CFDIs) must be retained **10 years** (CFF Art. 30).
> - IFT network logs must be retained **2 years** (telecoms law).

For erasable data (all other PII), run the following SQL inside a transaction
after confirming no legal retention hold applies:

```sql
START TRANSACTION;

-- 1. Anonymise client PII (preserves row for referential integrity)
UPDATE clients
SET name = '[ERASED]', email = '[ERASED]', phone = NULL, tax_id = NULL,
    address = NULL, city = NULL, state = NULL, zip_code = NULL,
    notes = NULL, deleted_at = NOW()
WHERE id = :client_id;

-- 2. Remove contacts
UPDATE contacts SET name = '[ERASED]', email = NULL, phone = NULL,
    deleted_at = NOW()
WHERE client_id = :client_id;

-- 3. Remove MX profile PII (retain record for CFDI references)
UPDATE client_mx_profiles SET curp = NULL WHERE client_id = :client_id;

-- 4. Anonymise connection logs older than IFT retention window
UPDATE connection_logs
SET ip_address = '0.0.0.0', mac_address = NULL, username = '[ERASED]'
WHERE client_id = :client_id
  AND session_start < DATE_SUB(NOW(), INTERVAL 2 YEAR);

-- 5. Remove ticket free-text (keep record for support SLA stats)
UPDATE tickets SET subject = '[ERASED]', description = '[ERASED]'
WHERE client_id = :client_id;

COMMIT;
```

After running: record the erasure in the [DSAR log](#dsar-log) and
communicate completion to the data subject.

---

## Retention periods

| Data category | Retention period | Trigger for deletion |
|---|---|---|
| Client PII (name, email, address) | Life of contract + 5 years | Contract termination + 5 years |
| Fiscal / invoicing data | 10 years from invoice date | 10-year anniversary |
| CFDI XML documents | 10 years from stamp date | 10-year anniversary |
| Network / connection logs | 2 years | Rolling 2-year window |
| Operator audit logs | 5 years | 5-year anniversary |
| 2FA secrets | Active account only | Account deactivation |
| Backups | 30 days (default) | Automated deletion by backup service |

---

## Third-party data processors

| Processor | Purpose | Data transferred | DPA / agreement |
|---|---|---|---|
| PAC provider (Finkok, SAT direct, etc.) | CFDI stamping | RFC, tax_id, invoice amounts | Terms of service; register in RNSP |
| SMTP provider (Nodemailer + any relay) | Transactional email | Email address, name | Data processing agreement required |
| Sentry (optional) | Error monitoring | Stack traces (no PII in production if SENTRY_SEND_PII=false) | Sentry DPA |
| AWS S3 / Cloudflare R2 (optional backup) | Database backups | All database data (encrypted at rest) | AWS DPA / Cloudflare DPA |
| Stripe / Conekta (optional) | Payment processing | Name, email, amount | Their own compliance (PCI-DSS) |
| Twilio (optional) | SMS | Phone number | Twilio DPA |

---

## Security measures

- Passwords stored as bcrypt hashes (cost factor 12).
- All API traffic over TLS 1.2+ (Let's Encrypt / Cloudflare).
- Database credentials managed via K8s Sealed Secrets (see `docs/secrets-management.md`).
- Pino logger redacts 62 sensitive field paths before writing logs (see `src/utils/logger.js`).
- `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]` on K8s pods.
- RBAC — `clients.view` permission required to access any client data.
- IP allowlist available for admin endpoints (`ADMIN_IP_ALLOWLIST`).
- 2FA (TOTP) supported for all operator accounts.

---

## DSAR log

Operators must record every completed DSAR below.  This log serves as
compliance evidence.

| Date | Type | Client ID | Requestor | Action | Completed by | Notes |
|---|---|---|---|---|---|---|
| _(first entry goes here)_ | | | | | | |
