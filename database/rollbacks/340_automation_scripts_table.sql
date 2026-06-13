-- =============================================================================
-- Rollback 340 — Drop automation_scripts + script_executions
-- =============================================================================
DROP TABLE IF EXISTS script_executions;
DROP TABLE IF EXISTS automation_scripts;
