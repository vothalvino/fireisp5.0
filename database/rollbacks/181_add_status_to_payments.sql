-- =============================================================================
-- FireISP 5.0 — Rollback 181: Remove payments.status
-- =============================================================================
-- Reverses migration 181 by dropping the status column from the payments table.
-- =============================================================================

ALTER TABLE payments
  DROP COLUMN status;
