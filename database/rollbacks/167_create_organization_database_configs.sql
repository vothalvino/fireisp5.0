-- =============================================================================
-- FireISP 5.0 — Rollback 167: Drop organization_database_configs table
-- =============================================================================
-- Reverses migration 167.  No other table references
-- organization_database_configs.
-- =============================================================================

DROP TABLE IF EXISTS organization_database_configs;
