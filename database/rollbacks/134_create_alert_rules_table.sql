-- =============================================================================
-- FireISP 5.0 — Rollback 134: Drop alert_rules table
-- =============================================================================
-- Reverses migration 134.  Run rollback 135 first (alert_events has a FK
-- to this table).
-- =============================================================================

DROP TABLE IF EXISTS alert_rules;
