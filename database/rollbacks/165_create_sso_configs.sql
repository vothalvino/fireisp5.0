-- =============================================================================
-- FireISP 5.0 — Rollback 165: Drop SSO configuration tables
-- =============================================================================
-- Reverses migration 165.  Tables are dropped in reverse-FK order:
-- organization_sso_group_mappings references organization_sso_configs, so it
-- is dropped first.  sso_auth_states has no foreign keys.
-- =============================================================================

DROP TABLE IF EXISTS sso_auth_states;
DROP TABLE IF EXISTS organization_sso_group_mappings;
DROP TABLE IF EXISTS organization_sso_configs;
