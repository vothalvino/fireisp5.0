-- =============================================================================
-- Rollback 339 — Drop remediation_rules + remediation_executions
-- =============================================================================
DROP TABLE IF EXISTS remediation_executions;
DROP TABLE IF EXISTS remediation_rules;
