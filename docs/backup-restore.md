# Backup & Disaster Recovery Guide

FireISP 5.0 includes a built-in backup script (`npm run backup`) that performs MySQL dumps with gzip compression and automatic rotation. This document covers the backup process, restore procedures, and disaster recovery planning.

> **Updating or recreating containers?** First confirm your data is on a
> persistent volume (not the container's ephemeral layer) with the
> [Volume Persistence — Verification & Migration Protocol](volume-persistence.md).

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
1. Runs `mysqldump` with `--single-transaction` (InnoDB-safe, no lock) and
   `--no-tablespaces` (so the app's DB user needs no global PROCESS privilege)
2. Compresses the output with gzip (in-process — no shell pipeline)
3. Saves to `storage/backups/` with timestamped filename
4. Uploads the file to the configured remote destination, if any (see
   [Remote (off-site) backups](#remote-off-site-backups))
5. Records the run — including the remote-upload outcome — in the
   `backup_runs` table, visible on the **/backups** admin page
6. Rotates old backups (keeps last 7 by default)

It **fails loudly** — a missing `mysqldump` binary, a non-zero dump exit, or a
suspiciously small output file (`BACKUP_MIN_BYTES`, default 512) throws and
removes the partial file, so a broken run can never masquerade as a backup.
The production image ships `default-mysql-client`; outside Docker, install the
MySQL client tools on the host. Optional env: `BACKUP_DIR` overrides the
output directory.

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
3. **Nightly (automatic)**: Remote upload to the configured S3-compatible destination — verify `remote_status` on the **/backups** page weekly
4. **Monthly**: Test restore procedure on a staging environment
5. **Quarterly**: Full disaster recovery drill

### Remote (Off-Site) Backups

FireISP uploads every backup to an S3-compatible destination automatically —
no extra tooling on the app server. Configure it either way:

* **UI (recommended)** — **Admin → Backups** (`/backups`, permission
  `backup_settings.view`/`.update`, admin-only): pick a provider, fill in
  bucket/region/keys, **Test connection** (uploads + deletes a probe object),
  enable, save. The secret key is AES-256-GCM encrypted at rest and never
  returned by the API. The same page shows the run history — including
  whether each night's remote upload actually succeeded.
* **Environment variables** — `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`,
  `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, optional
  `BACKUP_S3_ENDPOINT` / `BACKUP_S3_PREFIX` (see `.env.example`). Env vars
  are the fallback: an **enabled** UI configuration overrides them.

Supported providers (everything speaks the S3 API; only the endpoint differs):

| Provider | Endpoint | Notes |
|----------|----------|-------|
| Amazon S3 | *(derived from region)* | Standard access key + secret |
| Google Cloud Storage | `https://storage.googleapis.com` | Create **HMAC keys**: Cloud Storage → Settings → Interoperability → *Create a key*. Region `auto` works. |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | Application Key ID + Application Key |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | R2 API token (S3 credentials); region `auto` |
| MinIO / self-hosted | `http(s)://your-server:9000` | See below |
| Any S3-compatible | custom | Wasabi, DigitalOcean Spaces, Ceph RGW, … |

Remote retention is the bucket's job — set a lifecycle/expiration rule on the
bucket (e.g. delete objects under `db-backups/` after 90 days). The app only
rotates the **local** copies.

#### Self-hosted backup server with MinIO

To use your own second server as the backup target, install MinIO on **that
server** (it makes any Linux box speak the S3 API):

```bash
# On the BACKUP server (as root; adjust paths/user to taste)
curl -fLo /usr/local/bin/minio https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x /usr/local/bin/minio
useradd -r -s /sbin/nologin minio || true
mkdir -p /srv/minio-data && chown minio: /srv/minio-data

# Run as a service (systemd unit shown minimal; see min.io docs for TLS)
cat > /etc/systemd/system/minio.service <<'EOF'
[Unit]
Description=MinIO object storage
After=network.target
[Service]
User=minio
Environment="MINIO_ROOT_USER=CHANGE-ME-KEY"
Environment="MINIO_ROOT_PASSWORD=CHANGE-ME-SECRET-32-CHARS"
ExecStart=/usr/local/bin/minio server /srv/minio-data --console-address :9001
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now minio
```

Then open the MinIO console (`http://backup-server:9001`), create a bucket
(e.g. `fireisp-backups`) plus a dedicated access key, and in FireISP's
**Admin → Backups** choose provider **MinIO / self-hosted**, endpoint
`http://backup-server:9000`, region `us-east-1` (MinIO accepts any), and the
bucket + keys you created. Click **Test connection**. Prefer HTTPS (put
MinIO behind TLS or a reverse proxy) when backups cross the public internet —
the dump contains your entire customer database.

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
