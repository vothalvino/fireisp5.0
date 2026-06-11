-- =============================================================================
-- Migration 142: Add dead-letter support for webhook deliveries
-- =============================================================================
-- Adds a 'dead_letter' status value for webhook deliveries that have exhausted
-- all retry attempts, making them permanently failed and queryable for manual
-- review/re-delivery.
-- =============================================================================

-- Add dead_letter to the status enum (MySQL requires re-specifying all values)
ALTER TABLE webhook_deliveries
  MODIFY COLUMN status ENUM('pending', 'success', 'failed', 'retrying', 'dead_letter')
    NOT NULL DEFAULT 'pending'
    COMMENT 'Delivery status; dead_letter = all retries exhausted';

-- Index for dead-letter dashboard queries
-- Guarded with an INFORMATION_SCHEMA check so the migration is safely
-- re-runnable after a partial failure.
DROP PROCEDURE IF EXISTS migration_142_add_dead_letter_index;
DELIMITER //
CREATE PROCEDURE migration_142_add_dead_letter_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'webhook_deliveries'
      AND INDEX_NAME   = 'idx_webhook_deliveries_dead_letter'
  ) THEN
    CREATE INDEX idx_webhook_deliveries_dead_letter
      ON webhook_deliveries (status, webhook_id)
      COMMENT 'Fast lookup for dead-letter deliveries needing manual review';
  END IF;
END //
DELIMITER ;
CALL migration_142_add_dead_letter_index();
DROP PROCEDURE IF EXISTS migration_142_add_dead_letter_index;
