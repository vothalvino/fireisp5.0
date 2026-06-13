-- =============================================================================
-- Rollback 336 — Drop automation_rules + automation_rule_executions
-- =============================================================================
DROP TABLE IF EXISTS automation_rule_executions;
DROP TABLE IF EXISTS automation_rules;
