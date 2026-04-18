-- Migration: 156_seed_database_backup_task
-- Description: Seeds the database_backup scheduled task that runs mysqldump
--              daily at 03:00 UTC and uploads the compressed dump to
--              S3-compatible cloud storage (AWS S3 or Backblaze B2).
--
--              Configuration is provided via environment variables:
--                BACKUP_S3_BUCKET, BACKUP_S3_REGION,
--                BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY,
--                BACKUP_S3_ENDPOINT (optional, for B2 or other providers),
--                BACKUP_S3_PREFIX   (optional, default "db-backups/"),
--                BACKUP_RETENTION   (optional, local copies to keep, default 7)
--
--              When cloud storage is not configured, the task still creates a
--              local gzipped dump in storage/backups/ and logs a warning.
--
--              Uses INSERT IGNORE for idempotency — the scheduled_tasks table
--              has a UNIQUE KEY on (organization_id, task_name).

INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'database_backup',
     'maintenance',
     'Daily database backup: mysqldump → gzip → local storage/backups/ + upload to S3/B2 cloud storage. Retains last 7 local copies.',
     '0 3 * * *',   -- daily at 03:00 UTC
     'normal',
     2,
     1800,
     TRUE);
