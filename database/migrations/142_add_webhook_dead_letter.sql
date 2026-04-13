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
CREATE INDEX idx_webhook_deliveries_dead_letter
  ON webhook_deliveries (status, webhook_id)
  COMMENT 'Fast lookup for dead-letter deliveries needing manual review';
