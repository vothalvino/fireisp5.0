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

ALTER TABLE `organization_quotas`
  ADD COLUMN IF NOT EXISTS `ai_cost_month_usd`    DECIMAL(12,6) NULL DEFAULT NULL
    COMMENT 'Running monthly AI cost total (USD) — updated daily by aiCostRollupWorker',
  ADD COLUMN IF NOT EXISTS `ai_cost_rollup_month`  CHAR(7)       NULL DEFAULT NULL
    COMMENT 'YYYY-MM of the last rollup (used to detect month boundary)';
