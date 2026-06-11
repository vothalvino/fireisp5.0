-- =============================================================================
-- Rollback 159 — Remove auto_create_ticket from alert_rules
-- =============================================================================
-- Reverses migration 159. The DROP is INFORMATION_SCHEMA-guarded so the
-- rollback succeeds even if the column is already absent.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_159_drop_auto_create_ticket;
DELIMITER //
CREATE PROCEDURE rollback_159_drop_auto_create_ticket()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'alert_rules'
      AND COLUMN_NAME  = 'auto_create_ticket'
  ) THEN
    ALTER TABLE alert_rules DROP COLUMN auto_create_ticket;
  END IF;
END //
DELIMITER ;
CALL rollback_159_drop_auto_create_ticket();
DROP PROCEDURE IF EXISTS rollback_159_drop_auto_create_ticket;

ALTER TABLE alert_rules
  MODIFY COLUMN metric VARCHAR(50) NOT NULL
    COMMENT 'cpu_usage, memory_usage, signal_strength, latency_ms, packet_loss, uptime';
