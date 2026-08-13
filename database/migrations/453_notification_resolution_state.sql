-- =============================================================================
-- Migration 453 — distinguish automatic alert resolution from manual reading
-- =============================================================================
-- `is_read` answers whether a person acknowledged a notification. It cannot
-- also represent whether the underlying incident is still active: doing so
-- causes a repaired alert to suppress a later recurrence with the same key.
-- Keep both concepts explicitly. Existing rows remain unresolved so their
-- current de-duplication behavior is unchanged until a monitor observes that
-- the condition has cleared.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_453_notification_resolution_state;
DELIMITER //
CREATE PROCEDURE migration_453_notification_resolution_state()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'notifications'
       AND COLUMN_NAME = 'resolved_at'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN resolved_at DATETIME NULL
        COMMENT 'When the emitting monitor observed that the underlying condition cleared'
        AFTER read_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'notifications'
       AND INDEX_NAME = 'idx_notifications_entity_resolution'
  ) THEN
    ALTER TABLE notifications
      ADD KEY idx_notifications_entity_resolution (entity_type, resolved_at, deleted_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ops_alert_deliveries'
       AND COLUMN_NAME = 'resolved_at'
  ) THEN
    ALTER TABLE ops_alert_deliveries
      ADD COLUMN resolved_at DATETIME NULL
        COMMENT 'When the infrastructure condition cleared; NULL means the de-duplication claim is active'
        AFTER sent_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ops_alert_deliveries'
       AND INDEX_NAME = 'idx_ops_alert_deliveries_resolved_at'
  ) THEN
    ALTER TABLE ops_alert_deliveries
      ADD KEY idx_ops_alert_deliveries_resolved_at (resolved_at);
  END IF;
END //
DELIMITER ;

CALL migration_453_notification_resolution_state();
DROP PROCEDURE IF EXISTS migration_453_notification_resolution_state;
