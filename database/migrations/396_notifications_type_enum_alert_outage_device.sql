-- =============================================================================
-- Migration 396 — Extend notifications.type for alert/outage/device events
-- =============================================================================
-- The staff in-app notifications table gains three more event families:
--   alert   — monitoring alert rule breach / escalation step
--   outage  — outage reported/resolved
--   device  — device offline/online transition (detected by deviceStatusService)
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_396_notifications_type_enum;
DELIMITER //
CREATE PROCEDURE migration_396_notifications_type_enum()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'notifications'
      AND COLUMN_NAME  = 'type'
      AND COLUMN_TYPE NOT LIKE '%alert%'
  ) THEN
    ALTER TABLE notifications
      MODIFY COLUMN type ENUM('info','warning','error','billing','network','ticket','work_order','maintenance','alert','outage','device')
        NOT NULL DEFAULT 'info';
  END IF;
END //
DELIMITER ;
CALL migration_396_notifications_type_enum();
DROP PROCEDURE IF EXISTS migration_396_notifications_type_enum;
