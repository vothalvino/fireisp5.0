-- =============================================================================
-- Rollback 427 — drop the single-active-default guard on tax_rates
-- =============================================================================
-- WARNING: this reopens the possibility of two active default tax rates in one
-- org, which makes resolveTaxContext's LIMIT 1 nondeterministic — invoices then
-- bill at whichever rate MySQL returns first, with no error anywhere. Rows
-- demoted by the forward migration's pre-clean are NOT restored; re-pick the
-- intended default in Settings → Taxes if you roll back.
--
-- Index first, then the column: MySQL will not drop a generated column that an
-- index still depends on.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_427_tax_rate_default_guard;
DELIMITER //
CREATE PROCEDURE rollback_427_tax_rate_default_guard()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tax_rates'
      AND INDEX_NAME   = 'uq_tax_rates_default_guard'
  ) THEN
    ALTER TABLE tax_rates DROP INDEX uq_tax_rates_default_guard;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tax_rates'
      AND COLUMN_NAME  = 'default_guard'
  ) THEN
    ALTER TABLE tax_rates DROP COLUMN default_guard;
  END IF;
END //
DELIMITER ;

CALL rollback_427_tax_rate_default_guard();
DROP PROCEDURE IF EXISTS rollback_427_tax_rate_default_guard;
