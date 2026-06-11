-- =============================================================================
-- Migration 159 — Add auto_create_ticket to alert_rules
-- =============================================================================
-- Extends alert_rules with an auto_create_ticket flag so that when a threshold
-- breach is detected (e.g. bandwidth > 90%) a support ticket is automatically
-- opened against the offending device.
-- Also updates the metric column comment to document bandwidth metrics.
-- =============================================================================

-- Guarded with an INFORMATION_SCHEMA check so the migration is safely
-- re-runnable after a partial failure.
DROP PROCEDURE IF EXISTS migration_159_add_auto_create_ticket;
DELIMITER //
CREATE PROCEDURE migration_159_add_auto_create_ticket()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'alert_rules'
      AND COLUMN_NAME  = 'auto_create_ticket'
  ) THEN
    ALTER TABLE alert_rules
      ADD COLUMN auto_create_ticket BOOLEAN NOT NULL DEFAULT FALSE
        COMMENT 'When TRUE, automatically open a ticket on threshold breach'
        AFTER auto_create_outage;
  END IF;
END //
DELIMITER ;
CALL migration_159_add_auto_create_ticket();
DROP PROCEDURE IF EXISTS migration_159_add_auto_create_ticket;

ALTER TABLE alert_rules
  MODIFY COLUMN metric VARCHAR(50) NOT NULL
    COMMENT 'cpu_usage, memory_usage, signal_strength, latency_ms, packet_loss, uptime, if_in_octets, if_out_octets';
