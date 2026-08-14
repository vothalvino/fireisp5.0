-- =============================================================================
-- Migration 455 — make PPPoE diagnostics tenant-safe and collector-ready
-- =============================================================================
-- radpostauth was originally copied from the minimal FreeRADIUS schema.  It had
-- no tenant or NAS ownership, so an org-scoped diagnostics request could only
-- correlate rows by username.  Usernames are not globally unique across ISPs;
-- that correlation could both misclassify failures and expose another tenant's
-- authentication activity.  The embedded RADIUS server now writes these
-- ownership columns and an explicit, non-secret outcome reason.
--
-- RouterOS log polling is at-least-once.  source_key is the collector's SHA-256
-- fingerprint of a source log record; uniqueness is per NAS because two routers
-- can legitimately emit identical log lines.  NULL remains allowed for legacy
-- and manually ingested events.
--
-- The procedure guards every schema object independently.  This matters because
-- the migration runner executes MySQL DDL without a surrounding transaction, so
-- a deploy interrupted after any ALTER must be safe to resume.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_455_pppoe_diagnostics_telemetry;
DELIMITER //
CREATE PROCEDURE migration_455_pppoe_diagnostics_telemetry()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE radpostauth
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Owning organization resolved from the source NAS'
        AFTER id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND COLUMN_NAME = 'nas_id'
  ) THEN
    ALTER TABLE radpostauth
      ADD COLUMN nas_id BIGINT UNSIGNED NULL
        COMMENT 'Source NAS; loose reference so auth logging cannot be blocked by lifecycle changes'
        AFTER organization_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND COLUMN_NAME = 'reason_code'
  ) THEN
    ALTER TABLE radpostauth
      ADD COLUMN reason_code VARCHAR(50) NULL
        COMMENT 'Explicit non-secret authentication outcome classification'
        AFTER reply;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND INDEX_NAME = 'idx_radpostauth_org_authdate'
  ) THEN
    ALTER TABLE radpostauth
      ADD KEY idx_radpostauth_org_authdate (organization_id, authdate);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND INDEX_NAME = 'idx_radpostauth_nas_id'
  ) THEN
    ALTER TABLE radpostauth
      ADD KEY idx_radpostauth_nas_id (nas_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND INDEX_NAME = 'idx_radpostauth_reason_code'
  ) THEN
    ALTER TABLE radpostauth
      ADD KEY idx_radpostauth_reason_code (reason_code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pppoe_event_logs'
       AND COLUMN_NAME = 'source_key'
  ) THEN
    ALTER TABLE pppoe_event_logs
      ADD COLUMN source_key CHAR(64) NULL
        COMMENT 'SHA-256 source-record fingerprint used for at-least-once polling dedupe'
        AFTER nas_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pppoe_event_logs'
       AND INDEX_NAME = 'uq_pppoe_event_logs_nas_source'
  ) THEN
    ALTER TABLE pppoe_event_logs
      ADD UNIQUE KEY uq_pppoe_event_logs_nas_source (nas_id, source_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pppoe_event_logs'
       AND INDEX_NAME = 'idx_pppoe_event_logs_org_logged_at'
  ) THEN
    ALTER TABLE pppoe_event_logs
      ADD KEY idx_pppoe_event_logs_org_logged_at (organization_id, logged_at);
  END IF;
END //
DELIMITER ;

CALL migration_455_pppoe_diagnostics_telemetry();
DROP PROCEDURE IF EXISTS migration_455_pppoe_diagnostics_telemetry;

-- One global dispatcher entry.  A NULL organization_id does not collide in a
-- MySQL UNIQUE key, so INSERT IGNORE is not sufficient for idempotency here.
-- Five minutes keeps RouterOS login/API load conservative.  A fleet sweep is
-- serialized by a MySQL advisory mutex and may legitimately take longer than
-- one cadence when many routers are unreachable, so use a conservative one-hour
-- timeout metadata value instead of the table's five-minute default.  The
-- current runner does not enforce this value as a hard execution deadline.
INSERT INTO scheduled_tasks
  (organization_id, task_name, task_type, description, cron_expression,
   is_enabled, priority, timeout_seconds)
SELECT
  NULL,
  'poll_pppoe_events',
  'other',
  'Poll RouterOS PPPoE logs into the tenant-scoped diagnostics event stream',
  '*/5 * * * *',
  1,
  'normal',
  3600
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks
   WHERE task_name = 'poll_pppoe_events'
     AND organization_id IS NULL
);
