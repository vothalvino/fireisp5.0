-- =============================================================================
-- Migration 395 — Extend notifications.type for work-order + maintenance events
-- =============================================================================
-- The staff in-app notifications table gains two event families:
--   work_order  — "a work order was assigned to you" (technician dispatch)
--   maintenance — maintenance-window lifecycle events
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_395_notifications_type_enum;
DELIMITER //
CREATE PROCEDURE migration_395_notifications_type_enum()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'notifications'
      AND COLUMN_NAME  = 'type'
      AND COLUMN_TYPE NOT LIKE '%work_order%'
  ) THEN
    ALTER TABLE notifications
      MODIFY COLUMN type ENUM('info','warning','error','billing','network','ticket','work_order','maintenance')
        NOT NULL DEFAULT 'info';
  END IF;
END //
DELIMITER ;
CALL migration_395_notifications_type_enum();
DROP PROCEDURE IF EXISTS migration_395_notifications_type_enum;
