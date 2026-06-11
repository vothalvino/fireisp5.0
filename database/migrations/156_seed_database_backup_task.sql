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
--              Uses INSERT ... SELECT ... WHERE NOT EXISTS for idempotency.
--              The UNIQUE KEY on (organization_id, task_name) never collides
--              when organization_id is NULL (MySQL unique keys treat NULLs as
--              distinct), so INSERT IGNORE would duplicate the row on re-run.
--
--              task_type is 'backup' — the previous value 'maintenance' is not
--              part of the task_type ENUM (see migration 047) and was silently
--              stored as '' by INSERT IGNORE; 'backup' is the existing ENUM
--              member that matches this task's purpose.

INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'database_backup',
    'backup',
    'Daily database backup: mysqldump → gzip → local storage/backups/ + upload to S3/B2 cloud storage. Retains last 7 local copies.',
    '0 3 * * *',   -- daily at 03:00 UTC
    'normal',
    2,
    1800,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'database_backup' AND organization_id IS NULL
);
