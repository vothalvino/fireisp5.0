-- =============================================================================
-- Rollback 455 — remove PPPoE diagnostics ownership/dedupe additions
-- =============================================================================
-- Drop indexes before their columns.  In MySQL, dropping one column from a
-- multi-column index can leave a narrower index behind, which would make a
-- later forward migration fail or (for the unique key) enforce the wrong rule.
-- Every object is guarded so a partial forward migration can also be rolled
-- back safely.
-- =============================================================================

DELETE FROM scheduled_tasks
 WHERE task_name = 'poll_pppoe_events'
   AND organization_id IS NULL;

DROP PROCEDURE IF EXISTS rollback_455_pppoe_diagnostics_telemetry;
DELIMITER //
CREATE PROCEDURE rollback_455_pppoe_diagnostics_telemetry()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pppoe_event_logs'
       AND INDEX_NAME = 'idx_pppoe_event_logs_org_logged_at'
  ) THEN
    ALTER TABLE pppoe_event_logs
      DROP INDEX idx_pppoe_event_logs_org_logged_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pppoe_event_logs'
       AND INDEX_NAME = 'uq_pppoe_event_logs_nas_source'
  ) THEN
    ALTER TABLE pppoe_event_logs
      DROP INDEX uq_pppoe_event_logs_nas_source;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pppoe_event_logs'
       AND COLUMN_NAME = 'source_key'
  ) THEN
    ALTER TABLE pppoe_event_logs DROP COLUMN source_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND INDEX_NAME = 'idx_radpostauth_reason_code'
  ) THEN
    ALTER TABLE radpostauth DROP INDEX idx_radpostauth_reason_code;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND INDEX_NAME = 'idx_radpostauth_nas_id'
  ) THEN
    ALTER TABLE radpostauth DROP INDEX idx_radpostauth_nas_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND INDEX_NAME = 'idx_radpostauth_org_authdate'
  ) THEN
    ALTER TABLE radpostauth DROP INDEX idx_radpostauth_org_authdate;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND COLUMN_NAME = 'reason_code'
  ) THEN
    ALTER TABLE radpostauth DROP COLUMN reason_code;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND COLUMN_NAME = 'nas_id'
  ) THEN
    ALTER TABLE radpostauth DROP COLUMN nas_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'radpostauth'
       AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE radpostauth DROP COLUMN organization_id;
  END IF;
END //
DELIMITER ;

CALL rollback_455_pppoe_diagnostics_telemetry();
DROP PROCEDURE IF EXISTS rollback_455_pppoe_diagnostics_telemetry;
