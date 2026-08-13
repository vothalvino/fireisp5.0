-- Rollback 453 — remove explicit notification/ops-alert resolution state.
-- Reading state and notification history remain intact; a rollback restores
-- the pre-453 title-only de-duplication behavior.

DROP PROCEDURE IF EXISTS rollback_453_notification_resolution_state;
DELIMITER //
CREATE PROCEDURE rollback_453_notification_resolution_state()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'notifications'
       AND INDEX_NAME = 'idx_notifications_entity_resolution'
  ) THEN
    ALTER TABLE notifications DROP INDEX idx_notifications_entity_resolution;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'notifications'
       AND COLUMN_NAME = 'resolved_at'
  ) THEN
    ALTER TABLE notifications DROP COLUMN resolved_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ops_alert_deliveries'
       AND INDEX_NAME = 'idx_ops_alert_deliveries_resolved_at'
  ) THEN
    ALTER TABLE ops_alert_deliveries DROP INDEX idx_ops_alert_deliveries_resolved_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ops_alert_deliveries'
       AND COLUMN_NAME = 'resolved_at'
  ) THEN
    ALTER TABLE ops_alert_deliveries DROP COLUMN resolved_at;
  END IF;
END //
DELIMITER ;

CALL rollback_453_notification_resolution_state();
DROP PROCEDURE IF EXISTS rollback_453_notification_resolution_state;
