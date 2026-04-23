# FireISP 5.0 — Disaster-Recovery Drill

> **Frequency:** Run this drill **quarterly**.  Record each run in the
> [Quarterly Drill Log](#quarterly-drill-log) at the bottom of this file
> and commit the update to `main`.
>
> **Goal:** Confirm that a complete database backup can be taken, that the
> database can be destroyed and re-created from scratch, and that the
> restored state passes all referential-integrity and row-count checks —
> all within the documented Recovery Time Objective (RTO < 1 hour for the
> database layer).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Phase 1 — Take a Fresh Backup](#phase-1--take-a-fresh-backup)
3. [Phase 2 — Simulate Destruction](#phase-2--simulate-destruction)
4. [Phase 3 — Restore from Backup](#phase-3--restore-from-backup)
5. [Phase 4 — Verification Queries](#phase-4--verification-queries)
6. [Phase 5 — Restore Storage Files](#phase-5--restore-storage-files)
7. [Timing Record](#timing-record)
8. [Quarterly Drill Log](#quarterly-drill-log)

---

## Prerequisites

| Requirement | Check |
|---|---|
| `mysqldump` and `mysql` CLI in `PATH` | `mysqldump --version` |
| MySQL/MariaDB root or admin credentials | `.env` → `DB_ROOT_PASSWORD` or `DB_PASSWORD` |
| Enough disk space for the dump (≥ current DB size × 1.5) | `df -h` |
| FireISP application **stopped** or in maintenance mode during restore | `npm run stop` / `docker compose stop app` |
| Storage files backed up (optional but recommended) | `tar czf storage-$(date +%Y%m%d).tar.gz storage/` |

Set shell variables before starting to avoid typos across commands:

```bash
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-3306}"
export DB_NAME="${DB_NAME:-fireisp}"
export DB_USER="${DB_USER:-root}"
# Prompt once for the password — avoids storing it in shell history
read -s -p "MySQL password: " DB_PASS; export DB_PASS
```

---

## Phase 1 — Take a Fresh Backup

**Expected duration: 1–5 minutes** (depending on database size).

### 1a. Automated backup (recommended)

```bash
npm run backup
# Output example:
# {"level":"info","filename":"fireisp_2026-04-23T02-00-00.sql.gz","script":"backup","msg":"Backup created","sizeKB":"42312.8"}
```

The compressed dump is saved to `storage/backups/`.  Record the filename:

```bash
BACKUP_FILE=$(ls -t storage/backups/*.sql.gz | head -1)
echo "Backup: $BACKUP_FILE"
```

### 1b. Manual backup (if `npm run backup` is unavailable)

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="storage/backups/${DB_NAME}_${TIMESTAMP}.sql.gz"
mkdir -p storage/backups

mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASS" \
  --single-transaction \
  --routines --triggers --events \
  --set-gtid-purged=OFF \
  "$DB_NAME" | gzip > "$BACKUP_FILE"

echo "Backup size: $(du -sh "$BACKUP_FILE" | cut -f1)"
```

### 1c. Sanity check

```bash
# File must exist and be > 1 MB
SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
[ "$SIZE" -gt 1048576 ] && echo "OK: ${SIZE} bytes" || echo "WARNING: suspiciously small"

# Quick peek — first line of uncompressed dump
gunzip -c "$BACKUP_FILE" | head -5
```

Record the backup size and filename in [Timing Record](#timing-record).

---

## Phase 2 — Simulate Destruction

> **Caution:** This step permanently drops all data in the named database.
> Confirm you have completed Phase 1 before proceeding.

```bash
# Stop the application first
docker compose stop app 2>/dev/null || true

# Drop the database
mysql \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASS" \
  -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;"

# Verify it's gone
mysql \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASS" \
  -e "SHOW DATABASES LIKE '${DB_NAME}';" \
  | grep -q "$DB_NAME" \
  && echo "FAIL: database still exists" \
  || echo "OK: database dropped"
```

Record the time in [Timing Record](#timing-record).

---

## Phase 3 — Restore from Backup

**Expected duration: 5–15 minutes** (depending on database size).

```bash
# Create a fresh database
mysql \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASS" \
  -e "CREATE DATABASE \`${DB_NAME}\`
        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Restore from the backup taken in Phase 1
gunzip -c "$BACKUP_FILE" | \
  mysql \
    --host="$DB_HOST" --port="$DB_PORT" \
    --user="$DB_USER" --password="$DB_PASS" \
    "$DB_NAME"

echo "Restore exit code: $?"
```

### Enable the event scheduler (required for SNMP rollups and partition maintenance)

```bash
mysql \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASS" \
  -e "SET GLOBAL event_scheduler = ON;"
```

Record the restore completion time in [Timing Record](#timing-record).

---

## Phase 4 — Verification Queries

Run all queries below.  Each must return a non-zero count **and** zero FK
violations.  Record the counts in the drill log.

### 4a. Core table row counts

```sql
SELECT 'organizations'   AS tbl, COUNT(*) AS rows FROM organizations
UNION ALL
SELECT 'users',               COUNT(*) FROM users
UNION ALL
SELECT 'clients',             COUNT(*) FROM clients
UNION ALL
SELECT 'contracts',           COUNT(*) FROM contracts
UNION ALL
SELECT 'invoices',            COUNT(*) FROM invoices
UNION ALL
SELECT 'payments',            COUNT(*) FROM payments
UNION ALL
SELECT 'tickets',             COUNT(*) FROM tickets
UNION ALL
SELECT 'devices',             COUNT(*) FROM devices
UNION ALL
SELECT 'schema_migrations',   COUNT(*) FROM schema_migrations;
```

All `rows` values must be **≥ the pre-drill count** (or ≥ 1 for a
freshly-seeded drill environment).  The `schema_migrations` count must be
**163** (as of FireISP 5.0.x).

### 4b. Referential integrity — orphaned child rows

All queries below must return **0**.

```sql
-- Contracts without a valid client
SELECT COUNT(*) AS orphaned_contracts
FROM contracts c
LEFT JOIN clients cl ON cl.id = c.client_id
WHERE cl.id IS NULL;

-- Invoices without a valid client
SELECT COUNT(*) AS orphaned_invoices
FROM invoices i
LEFT JOIN clients cl ON cl.id = i.client_id
WHERE cl.id IS NULL;

-- Payments without a valid client
SELECT COUNT(*) AS orphaned_payments
FROM payments p
LEFT JOIN clients cl ON cl.id = p.client_id
WHERE cl.id IS NULL;

-- Payment allocations without a matching payment
SELECT COUNT(*) AS orphaned_allocations
FROM payment_allocations pa
LEFT JOIN payments p ON p.id = pa.payment_id
WHERE p.id IS NULL;

-- Radius records without a valid contract
SELECT COUNT(*) AS orphaned_radius
FROM radius r
LEFT JOIN contracts c ON c.id = r.contract_id
WHERE c.id IS NULL;

-- Users without a valid organization
SELECT COUNT(*) AS orphaned_users
FROM users u
LEFT JOIN organizations o ON o.id = u.organization_id
WHERE o.id IS NULL;
```

### 4c. Financial consistency

```sql
-- Invoice totals must equal the sum of their line items (delta ≤ 0.01 for rounding)
SELECT COUNT(*) AS inconsistent_invoices
FROM invoices i
JOIN (
  SELECT invoice_id, SUM(subtotal) AS lines_subtotal
  FROM invoice_items
  GROUP BY invoice_id
) ii ON ii.invoice_id = i.id
WHERE ABS(i.subtotal - ii.lines_subtotal) > 0.01;

-- Payment allocations must not exceed the payment amount
SELECT COUNT(*) AS over_allocated_payments
FROM payments p
JOIN (
  SELECT payment_id, SUM(amount_applied) AS total_applied
  FROM payment_allocations
  GROUP BY payment_id
) pa ON pa.payment_id = p.id
WHERE pa.total_applied > p.amount + 0.01;
```

### 4d. Application preflight

```bash
# Run the built-in preflight check (starts application against the restored DB)
mysql \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASS" \
  "$DB_NAME" \
  -e "CALL preflight_check_event_scheduler();"
```

```bash
# Alternatively — start the application and call the health endpoint
npm start &
APP_PID=$!
sleep 5
curl -sf http://localhost:3000/health/ready && echo "READY" || echo "NOT READY"
kill $APP_PID
```

---

## Phase 5 — Restore Storage Files

If a storage archive was taken in the prerequisites step:

```bash
tar xzf "storage-$(date +%Y%m%d).tar.gz" -C /path/to/fireisp5.0/
```

Verify that uploaded PDFs and client documents are accessible:

```bash
ls -lh storage/clients/ | head -10
ls -lh storage/organizations/ | head -10
```

---

## Timing Record

Use this table to record durations during each drill run.  Copy the row
template into the [Quarterly Drill Log](#quarterly-drill-log).

| Phase | Activity | Start | End | Duration |
|---|---|---|---|---|
| Phase 1 | Take backup | HH:MM | HH:MM | ___ min |
| Phase 2 | Drop database | HH:MM | HH:MM | ___ min |
| Phase 3 | Restore from backup | HH:MM | HH:MM | ___ min |
| Phase 4 | Run verification queries | HH:MM | HH:MM | ___ min |
| **Total** | **Full DR drill** | **HH:MM** | **HH:MM** | **___ min** |

**RTO target:** Total drill time ≤ 60 minutes.  If it exceeds this, open
a P1 issue to investigate the bottleneck.

---

## Quarterly Drill Log

> When you complete a drill, append a row here, fill in the results, and
> commit the file to `main`.

| Date | Operator | Environment | DB Size | Backup Duration | Restore Duration | Total Duration | Verification | Notes |
|---|---|---|---|---|---|---|---|---|
| _YYYY-MM-DD_ | _name_ | _staging / docker / bare-metal_ | _MB_ | _min_ | _min_ | _min_ | ✅ / ❌ | — |
