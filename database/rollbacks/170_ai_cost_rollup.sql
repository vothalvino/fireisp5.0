-- =============================================================================
-- FireISP 5.0 — Rollback 170: Remove AI cost-rollup columns from
--                             organization_quotas
-- =============================================================================
-- Reverses migration 170.  Drops ai_cost_rollup_month and ai_cost_month_usd.
--
-- Guarded on INFORMATION_SCHEMA (MySQL 8 has no DROP COLUMN IF EXISTS).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_170_drop_ai_cost_columns;
DELIMITER //
CREATE PROCEDURE rollback_170_drop_ai_cost_columns()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organization_quotas'
      AND COLUMN_NAME  = 'ai_cost_rollup_month'
  ) THEN
    ALTER TABLE organization_quotas DROP COLUMN ai_cost_rollup_month;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organization_quotas'
      AND COLUMN_NAME  = 'ai_cost_month_usd'
  ) THEN
    ALTER TABLE organization_quotas DROP COLUMN ai_cost_month_usd;
  END IF;
END //
DELIMITER ;
CALL rollback_170_drop_ai_cost_columns();
DROP PROCEDURE IF EXISTS rollback_170_drop_ai_cost_columns;
