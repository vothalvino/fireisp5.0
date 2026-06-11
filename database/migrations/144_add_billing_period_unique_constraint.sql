-- =============================================================================
-- Migration 144: Add unique constraint for invoice generation idempotency
-- =============================================================================
-- Prevents duplicate invoices for the same contract and billing period.
-- Guarded with an INFORMATION_SCHEMA check so the migration is safely
-- re-runnable after a partial failure.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_144_add_billing_period_unique;
DELIMITER //
CREATE PROCEDURE migration_144_add_billing_period_unique()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'billing_periods'
      AND INDEX_NAME   = 'uq_billing_period_contract_dates'
  ) THEN
    ALTER TABLE billing_periods
      ADD UNIQUE INDEX uq_billing_period_contract_dates (contract_id, period_start, period_end);
  END IF;
END //
DELIMITER ;
CALL migration_144_add_billing_period_unique();
DROP PROCEDURE IF EXISTS migration_144_add_billing_period_unique;
