# Data Migration Runbook

This runbook covers migrating an existing ISP's data into FireISP 5.0. It applies when you are replacing a legacy billing system, spreadsheet-based operation, or another ISP management platform.

---

## Table of Contents

1. [Overview](#overview)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Migration Order](#migration-order)
4. [Step 1 — Back Up the Target Database](#step-1--back-up-the-target-database)
5. [Step 2 — Import Clients](#step-2--import-clients)
6. [Step 3 — Import Devices](#step-3--import-devices)
7. [Step 4 — Import Contracts](#step-4--import-contracts)
8. [Step 5 — Import Invoices](#step-5--import-invoices)
9. [Step 6 — Import Payments](#step-6--import-payments)
10. [Step 7 — Post-Migration Verification](#step-7--post-migration-verification)
11. [Rollback Procedure](#rollback-procedure)
12. [Column Reference](#column-reference)
13. [Troubleshooting](#troubleshooting)

---

## Overview

FireISP 5.0 exposes bulk-import API endpoints that accept **CSV** files. Each endpoint inserts rows independently — errors in individual rows do not abort the entire import; instead they are collected and returned in the response.

### Import endpoints summary

| Resource | JSON (CSV body) | File upload |
|---|---|---|
| Clients | `POST /api/import/clients` | `POST /api/import/clients/upload` |
| Devices | `POST /api/import/devices` | `POST /api/import/devices/upload` |
| Contracts | `POST /api/import/contracts` | `POST /api/import/contracts/upload` |
| Invoices | `POST /api/import/invoices` | `POST /api/import/invoices/upload` |
| Payments | `POST /api/import/payments` | `POST /api/import/payments/upload` |

All endpoints require authentication and the `X-Org-Id` header. File uploads use `multipart/form-data` with the field name `file`. Maximum file size is **10 MB**. Maximum rows per import is **10,000**.

---

## Pre-Migration Checklist

Before importing any data, complete every item on this checklist:

- [ ] FireISP 5.0 is installed and all database migrations have been applied (`npm run migrate`)
- [ ] At least one Organization exists in the system
- [ ] At least one admin user exists and can obtain a JWT token
- [ ] All required **Plans** exist (`POST /api/plans`) — contracts reference `plan_id`
- [ ] All required **Sites** exist (`POST /api/sites`) — devices reference `site_id`
- [ ] A fresh backup of the target database has been taken (`npm run backup`)
- [ ] Source data has been exported to CSV
- [ ] Source data has been reviewed for encoding (UTF-8 required) and date format (`YYYY-MM-DD`)
- [ ] A staging environment has been used to validate the import before running on production

---

## Migration Order

Data must be imported in this order to satisfy foreign-key dependencies:

```
1. Clients          (no dependencies)
2. Devices          (no dependencies — site_id is optional)
3. Contracts        (depends on: clients, plans)
4. Invoices         (depends on: clients, contracts)
5. Payments         (depends on: clients, invoices)
```

---

## Step 1 — Back Up the Target Database

Always take a backup before starting. The import operations cannot be automatically rolled back.

```bash
npm run backup
# Backup written to storage/backups/fireisp_<timestamp>.sql.gz
```

To back up from Docker:

```bash
docker compose exec app npm run backup
```

Record the backup filename. You will need it if rollback is required.

---

## Step 2 — Import Clients

Clients are the top-level entity. Import them first so that their auto-generated IDs can be used in subsequent imports.

### Prepare the CSV

```csv
first_name,last_name,email,phone,city,state,country
Juan,Pérez,juan@ejemplo.com,5551234567,CDMX,Ciudad de México,MX
María,López,maria@ejemplo.com,5559876543,Monterrey,Nuevo León,MX
```

Required columns: `first_name`, `last_name`  
Optional columns: `email`, `phone`, `city`, `state`, `country`

### Import via file upload

```bash
curl -X POST http://localhost:3000/api/import/clients/upload \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>" \
  -F "file=@clients.csv"
```

### Import via JSON body

```bash
curl -X POST http://localhost:3000/api/import/clients \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>" \
  -H "Content-Type: application/json" \
  -d '{"csv": "first_name,last_name,email\nJuan,Pérez,juan@ejemplo.com"}'
```

### Response

```json
{
  "data": {
    "imported": 150,
    "total": 152,
    "errors": [
      { "row": 23, "error": "first_name and last_name are required" },
      { "row": 89, "error": "Duplicate entry 'juan@ejemplo.com' for key 'email'" }
    ]
  }
}
```

Review every error before proceeding. Fix the source file and re-run only the failing rows (they will not duplicate rows that already succeeded).

### Retrieve imported IDs

After importing clients, retrieve their FireISP IDs to map them to contracts and invoices:

```bash
curl "http://localhost:3000/api/clients?limit=100" \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>"
```

---

## Step 3 — Import Devices

Devices represent network equipment (routers, switches, APs, ONUs). Import is optional — skip if no device data is being migrated.

### Prepare the CSV

```csv
name,ip_address,type,site_id,mac_address,snmp_community
Core-Router-01,192.168.1.1,router,1,AA:BB:CC:DD:EE:01,public
AP-Sector-Norte,10.10.1.5,access_point,2,AA:BB:CC:DD:EE:02,public
```

Required columns: `name`, `ip_address`  
Optional columns: `type` (default `router`), `site_id`, `mac_address`, `snmp_community`

### Import

```bash
curl -X POST http://localhost:3000/api/import/devices/upload \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>" \
  -F "file=@devices.csv"
```

---

## Step 4 — Import Contracts

Contracts link a client to a service plan. The `client_id` and `plan_id` must already exist.

### Prepare the CSV

```csv
client_id,plan_id,start_date,connection_type
101,5,2025-01-01,fiber
102,3,2025-02-15,cable
103,5,2025-03-01,wireless
```

Required columns: `client_id`, `plan_id`  
Optional columns: `start_date` (default today), `connection_type` (default `fiber`)

### Import

```bash
curl -X POST http://localhost:3000/api/import/contracts/upload \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>" \
  -F "file=@contracts.csv"
```

### Retrieve imported IDs

```bash
curl "http://localhost:3000/api/contracts?limit=100" \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>"
```

---

## Step 5 — Import Invoices

Historical invoices from the legacy system. The `client_id` must already exist; `contract_id` is optional.

### Prepare the CSV

```csv
client_id,contract_id,invoice_number,issue_date,due_date,subtotal,tax_rate,total,status,notes
101,201,INV-2025-0001,2025-01-01,2025-01-15,500.00,0.16,580.00,paid,
102,202,INV-2025-0002,2025-01-01,2025-01-15,350.00,0.16,406.00,overdue,Cobro pendiente
```

Required columns: `client_id`, `invoice_number`, `issue_date`, `due_date`  
Optional columns: `contract_id`, `subtotal`, `tax_rate`, `tax_amount` (calculated if omitted), `total` (calculated if omitted), `status` (default `draft`), `notes`

Valid `status` values: `draft`, `sent`, `paid`, `overdue`, `cancelled`

### Import

```bash
curl -X POST http://localhost:3000/api/import/invoices/upload \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>" \
  -F "file=@invoices.csv"
```

---

## Step 6 — Import Payments

Historical payment records. The `client_id` must already exist; `invoice_id` is optional but recommended so payments are linked to invoices.

### Prepare the CSV

```csv
client_id,invoice_id,amount,payment_date,payment_method,reference_number,bank_name,notes
101,301,580.00,2025-01-10,bank_transfer,TRF-0012345,BBVA,
102,,350.00,2025-01-12,cash,,,Pago parcial
```

Required columns: `client_id`, `amount`, `payment_date`  
Optional columns: `invoice_id`, `payment_method` (default `cash`), `sat_forma_pago`, `reference_number`, `clabe`, `bank_name`, `notes`

Valid `payment_method` values: `cash`, `check`, `credit_card`, `debit_card`, `bank_transfer`, `oxxo_pay`, `spei`, `codi`, `convenience_store`, `digital_wallet`, `other`

### Import

```bash
curl -X POST http://localhost:3000/api/import/payments/upload \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>" \
  -F "file=@payments.csv"
```

---

## Step 7 — Post-Migration Verification

Run these SQL queries against the production database to confirm the migration completed correctly.

### Row counts

```sql
-- Compare against your source system's record counts
SELECT 'clients'   AS entity, COUNT(*) AS count FROM clients WHERE organization_id = <org_id>
UNION ALL
SELECT 'contracts', COUNT(*) FROM contracts WHERE organization_id = <org_id>
UNION ALL
SELECT 'devices',   COUNT(*) FROM devices   WHERE organization_id = <org_id>
UNION ALL
SELECT 'invoices',  COUNT(*) FROM invoices  WHERE client_id IN (SELECT id FROM clients WHERE organization_id = <org_id>)
UNION ALL
SELECT 'payments',  COUNT(*) FROM payments  WHERE client_id IN (SELECT id FROM clients WHERE organization_id = <org_id>);
```

### Client balance check

```sql
-- Verify total invoiced vs total paid match legacy system totals
SELECT
  SUM(total)       AS total_invoiced,
  SUM(amount_paid) AS total_paid,
  SUM(balance_due) AS total_outstanding
FROM invoices
WHERE client_id IN (SELECT id FROM clients WHERE organization_id = <org_id>);
```

### Orphaned contracts (contracts without a matching client)

```sql
SELECT c.id, c.client_id
FROM contracts c
LEFT JOIN clients cl ON cl.id = c.client_id
WHERE cl.id IS NULL;
-- Should return 0 rows
```

### Orphaned invoice-payment links

```sql
SELECT p.id, p.invoice_id
FROM payments p
WHERE p.invoice_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id);
-- Should return 0 rows
```

### Spot-check specific clients

```bash
# Fetch a known client by email
curl "http://localhost:3000/api/clients?email=juan@ejemplo.com" \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>"

# Fetch their invoices
curl "http://localhost:3000/api/invoices?client_id=<client_id>" \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>"
```

---

## Rollback Procedure

The import endpoints do not support transactional rollback across a full batch. If the migration must be reverted, restore from the backup taken in Step 1.

### 1. Identify the backup file

```bash
ls -lh storage/backups/
# e.g. fireisp_2026-04-20T02-00-00.sql.gz
```

### 2. Drop and recreate the database

```bash
mysql -u root -p -e "DROP DATABASE fireisp; CREATE DATABASE fireisp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 3. Restore the backup

```bash
gunzip < storage/backups/fireisp_2026-04-20T02-00-00.sql.gz | mysql -u root -p fireisp
```

### 4. Verify row counts match pre-migration state

```sql
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema = 'fireisp'
ORDER BY table_name;
```

### 5. Re-enable MySQL event scheduler

The event scheduler must be enabled after a restore:

```sql
SET GLOBAL event_scheduler = ON;
```

---

## Column Reference

### Clients

| Column | Required | Type | Notes |
|---|---|---|---|
| `first_name` | ✅ | string | |
| `last_name` | ✅ | string | |
| `email` | — | string | Must be unique if provided |
| `phone` | — | string | |
| `city` | — | string | |
| `state` | — | string | |
| `country` | — | string | ISO 3166-1 alpha-2 recommended (e.g. `MX`) |

### Devices

| Column | Required | Type | Notes |
|---|---|---|---|
| `name` | ✅ | string | |
| `ip_address` | ✅ | string | IPv4 or IPv6 |
| `type` | — | string | Default `router`. Common values: `router`, `switch`, `access_point`, `onu`, `olt` |
| `site_id` | — | integer | Must match an existing site |
| `mac_address` | — | string | |
| `snmp_community` | — | string | |

### Contracts

| Column | Required | Type | Notes |
|---|---|---|---|
| `client_id` | ✅ | integer | Must match an existing client |
| `plan_id` | ✅ | integer | Must match an existing plan |
| `start_date` | — | date (`YYYY-MM-DD`) | Default: today |
| `connection_type` | — | string | Default `fiber`. Common values: `fiber`, `cable`, `wireless`, `dsl`, `dedicated` |

### Invoices

| Column | Required | Type | Notes |
|---|---|---|---|
| `client_id` | ✅ | integer | Must match an existing client |
| `invoice_number` | ✅ | string | Must be unique |
| `issue_date` | ✅ | date (`YYYY-MM-DD`) | |
| `due_date` | ✅ | date (`YYYY-MM-DD`) | |
| `contract_id` | — | integer | |
| `subtotal` | — | decimal | |
| `tax_rate` | — | decimal | e.g. `0.16` for 16% IVA |
| `tax_amount` | — | decimal | Calculated from `subtotal × tax_rate` if omitted |
| `total` | — | decimal | Calculated from `subtotal + tax_amount` if omitted |
| `status` | — | string | One of: `draft`, `sent`, `paid`, `overdue`, `cancelled`. Default `draft` |
| `notes` | — | string | |

### Payments

| Column | Required | Type | Notes |
|---|---|---|---|
| `client_id` | ✅ | integer | Must match an existing client |
| `amount` | ✅ | decimal | Must be positive |
| `payment_date` | ✅ | date (`YYYY-MM-DD`) | |
| `invoice_id` | — | integer | Link to a specific invoice |
| `payment_method` | — | string | Default `cash`. See valid values below |
| `sat_forma_pago` | — | string | SAT catalog key (e.g. `01` = cash, `03` = transfer) |
| `reference_number` | — | string | Bank reference or transaction ID |
| `clabe` | — | string | CLABE for SPEI transfers |
| `bank_name` | — | string | |
| `notes` | — | string | |

Valid `payment_method` values: `cash`, `check`, `credit_card`, `debit_card`, `bank_transfer`, `oxxo_pay`, `spei`, `codi`, `convenience_store`, `digital_wallet`, `other`

---

## Troubleshooting

### `422 VALIDATION_ERROR: csv field is required`

You sent a JSON body request without the `csv` field, or you forgot to set `Content-Type: application/json`.

### `422 UPLOAD_ERROR: Only .csv files are accepted`

The uploaded file has a disallowed extension or MIME type. Ensure your file is named with `.csv` and uploaded with a `text/csv` content type.

### `422 UPLOAD_ERROR: File too large`

The import file exceeds 10 MB. Split it into multiple files of under 10,000 rows each and import them sequentially.

### Row-level error: `first_name and last_name are required`

The row in your source file is missing one or both name columns. Check for empty cells or misaligned columns.

### Row-level error: `Duplicate entry '...' for key 'email'`

A client with that email already exists. If you are re-running a partial import, skip rows that have already been imported successfully.

### Row-level error: `client_id and plan_id are required` (contracts)

The row is missing a `client_id` or `plan_id`. Ensure clients and plans were imported before contracts.

### Row-level error: `status must be one of: ...`

The `status` column contains a value not in the allowed set. Correct the value in your source file.

### Row-level error: `amount must be a positive number`

The `amount` column contains a non-numeric value, zero, or a negative number.

### Date format issues

All date columns must be in `YYYY-MM-DD` format. Common legacy formats (`DD/MM/YYYY`, `MM-DD-YY`) must be converted before importing. You can use a spreadsheet formula:

```
=TEXT(A2, "YYYY-MM-DD")
```

Or a Python script:

```python
import pandas as pd
df = pd.read_csv("clients.csv")
df["start_date"] = pd.to_datetime(df["start_date"], dayfirst=True).dt.strftime("%Y-%m-%d")
df.to_csv("clients_fixed.csv", index=False)
```

### Character encoding issues

FireISP expects **UTF-8**. If your source file uses Windows-1252 or Latin-1, convert it first:

```bash
iconv -f WINDOWS-1252 -t UTF-8 clients_legacy.csv > clients.csv
```
