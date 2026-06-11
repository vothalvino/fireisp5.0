-- =============================================================================
-- Migration 170 — AI cost-rollup usage column
-- =============================================================================
-- Adds a per-org monthly AI cost usage tracker to organization_quotas so the
-- aiCostRollupWorker (§4) can persist its daily aggregates.
--
-- ai_cost_month_usd:  running total of ai_reply_logs.cost_usd for the current
--                     calendar month.  Reset to 0 at month boundary by the
--                     same worker.  NULL = no data yet this month.
-- =============================================================================

-- Guarded with INFORMATION_SCHEMA checks so the migration is safely
-- re-runnable after a partial failure.
DROP PROCEDURE IF EXISTS migration_170_add_ai_cost_rollup_columns;
DELIMITER //
CREATE PROCEDURE migration_170_add_ai_cost_rollup_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organization_quotas'
      AND COLUMN_NAME  = 'ai_cost_month_usd'
  ) THEN
    ALTER TABLE `organization_quotas`
      ADD COLUMN `ai_cost_month_usd`    DECIMAL(12,6) NULL DEFAULT NULL
        COMMENT 'Running monthly AI cost total (USD) — updated daily by aiCostRollupWorker';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organization_quotas'
      AND COLUMN_NAME  = 'ai_cost_rollup_month'
  ) THEN
    ALTER TABLE `organization_quotas`
      ADD COLUMN `ai_cost_rollup_month`  CHAR(7)       NULL DEFAULT NULL
        COMMENT 'YYYY-MM of the last rollup (used to detect month boundary)';
  END IF;
END //
DELIMITER ;
CALL migration_170_add_ai_cost_rollup_columns();
DROP PROCEDURE IF EXISTS migration_170_add_ai_cost_rollup_columns;
