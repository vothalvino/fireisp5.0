-- =============================================================================
-- FireISP 5.0 — Rollback 142: Revert webhook_deliveries dead-letter support
-- =============================================================================
-- Reverses migration 142.  Restores the original ENUM (without 'dead_letter')
-- and drops the dead-letter index.
-- WARNING: Any rows with status = 'dead_letter' will fail this ALTER. Change
--          them to 'failed' first if they exist.
-- =============================================================================

-- Drop the dead-letter index
DROP INDEX idx_webhook_deliveries_dead_letter ON webhook_deliveries;

-- Restore original ENUM without dead_letter
ALTER TABLE webhook_deliveries
  MODIFY COLUMN status ENUM('pending', 'success', 'failed', 'retrying')
    NOT NULL DEFAULT 'pending'
    COMMENT 'Delivery outcome status';
