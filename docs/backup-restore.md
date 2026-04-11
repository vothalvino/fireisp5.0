# Backup & Disaster Recovery Guide

FireISP 5.0 includes a built-in backup script (`npm run backup`) that performs MySQL dumps with gzip compression and automatic rotation. This document covers the backup process, restore procedures, and disaster recovery planning.

---

## Table of Contents

1. [Automated Backups](#automated-backups)
2. [Manual Backup](#manual-backup)
3. [Restore Procedures](#restore-procedures)
4. [Disaster Recovery Plan](#disaster-recovery-plan)
5. [Storage Directory Layout](#storage-directory-layout)

---

## Automated Backups

### Built-in Backup Script

```bash
npm run backup
```

This script (`src/scripts/backup.js`):
1. Runs `mysqldump` with `--single-transaction` (InnoDB-safe, no lock)
2. Compresses the output with gzip
3. Saves to `storage/backups/` with timestamped filename
4. Rotates old backups (keeps last 7 by default)

### Schedule with Cron

Add a cron job on the host machine:

```bash
# Daily backup at 2:00 AM
0 2 * * * cd /path/to/fireisp5.0 && npm run backup >> /var/log/fireisp-backup.log 2>&1
```

### Docker Backup

When running in Docker, backup from the host:

```bash
docker compose exec app npm run backup
```

Or backup the MySQL container directly:

```bash
docker compose exec db mysqldump -u root -p"$DB_PASSWORD" \
  --single-transaction --routines --triggers --events \
  fireisp | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
```

---

## Manual Backup

### Full Database Dump

```bash
mysqldump -u root -p \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  fireisp | gzip > fireisp-full-$(date +%Y%m%d-%H%M%S).sql.gz
```

> **Important flags:**
> - `--single-transaction`: Consistent snapshot without locking (InnoDB)
> - `--routines`: Includes stored procedures and functions
> - `--triggers`: Includes guard triggers (payment allocation, inventory, RADIUS)
> - `--events`: Includes SNMP rollup and connection_logs partition maintenance events

### Schema-Only Backup

```bash
mysqldump -u root -p --no-data --routines --triggers --events fireisp > schema-only.sql
```

### Specific Table Backup

```bash
# Backup just the SNMP metrics (large tables)
mysqldump -u root -p --single-transaction fireisp \
  snmp_metrics snmp_metrics_1hr snmp_metrics_1day | gzip > snmp-data.sql.gz

# Backup just financial data
mysqldump -u root -p --single-transaction fireisp \
  invoices invoice_items payments payment_allocations \
  credit_notes credit_note_items cfdi_documents | gzip > financial-data.sql.gz
```

### Storage Files Backup

```bash
# Backup uploaded files and generated documents
tar czf storage-$(date +%Y%m%d).tar.gz storage/
```

---

## Restore Procedures

### Full Restore

```bash
# 1. Create a fresh database (if needed)
mysql -u root -p -e "CREATE DATABASE fireisp_restored CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. Restore from backup
gunzip < backup-20260401-020000.sql.gz | mysql -u root -p fireisp_restored

# 3. Verify the restore
mysql -u root -p fireisp_restored -e "SELECT COUNT(*) FROM schema_migrations;"
mysql -u root -p fireisp_restored -e "SELECT COUNT(*) FROM clients;"

# 4. Enable event scheduler (required for SNMP rollups and partition maintenance)
mysql -u root -p -e "SET GLOBAL event_scheduler = ON;"

# 5. Run preflight check
mysql -u root -p fireisp_restored -e "CALL preflight_check_event_scheduler();"
```

### Restore to Docker

```bash
# Copy backup into container
docker cp backup.sql.gz fireisp-db-1:/tmp/

# Restore inside container
docker compose exec db sh -c "gunzip < /tmp/backup.sql.gz | mysql -u root -p\$MYSQL_ROOT_PASSWORD fireisp"
```

### Point-in-Time Recovery (MySQL Binary Logs)

For point-in-time recovery, enable binary logging in MySQL:

```ini
# my.cnf
[mysqld]
log-bin = mysql-bin
binlog_expire_logs_seconds = 604800  # 7 days
server-id = 1
```

Restore to a specific point:

```bash
# 1. Restore the last full backup
gunzip < backup.sql.gz | mysql -u root -p fireisp

# 2. Apply binary logs up to the desired timestamp
mysqlbinlog --stop-datetime="2026-04-01 15:30:00" mysql-bin.000042 | mysql -u root -p fireisp
```

### Restore Storage Files

```bash
tar xzf storage-20260401.tar.gz -C /path/to/fireisp5.0/
```

---

## Disaster Recovery Plan

### Recovery Time Objectives

| Scenario | RTO | RPO |
|----------|-----|-----|
| Database corruption | < 1 hour | Last backup (daily) |
| Server failure | < 2 hours | Last backup + binary logs |
| Data center outage | < 4 hours | Last off-site backup |

### Checklist

1. **Daily**: Automated backup runs at 2:00 AM
2. **Daily**: Verify backup file exists and is > 0 bytes
3. **Weekly**: Copy latest backup to off-site storage (S3, GCS, etc.)
4. **Monthly**: Test restore procedure on a staging environment
5. **Quarterly**: Full disaster recovery drill

### Off-Site Backup with AWS S3

```bash
# Install AWS CLI and configure credentials
aws s3 cp storage/backups/latest.sql.gz s3://fireisp-backups/$(date +%Y/%m)/

# Or sync all backups
aws s3 sync storage/backups/ s3://fireisp-backups/
```

### Monitoring

Add backup verification to your monitoring system:

```bash
#!/bin/bash
# Check that today's backup exists and is > 1MB
BACKUP_DIR="/path/to/fireisp5.0/storage/backups"
TODAY=$(date +%Y%m%d)
LATEST=$(ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "CRITICAL: No backup files found"
  exit 2
fi

SIZE=$(stat -f%z "$LATEST" 2>/dev/null || stat -c%s "$LATEST")
if [ "$SIZE" -lt 1048576 ]; then
  echo "WARNING: Latest backup is suspiciously small (${SIZE} bytes)"
  exit 1
fi

echo "OK: Latest backup is ${SIZE} bytes"
exit 0
```

---

## Storage Directory Layout

```
storage/
├── backups/         # Database backup files (.sql.gz)
├── clients/         # Per-client documents
├── devices/         # Device history, evidence
├── organizations/   # Logos, SAT certificates, maps
└── tickets/         # Ticket attachments
```

All paths are relative to the FireISP installation directory. The `files` database table stores metadata and references to each stored file.
