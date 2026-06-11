-- =============================================================================
-- FireISP 5.0 — Rollback 166: Drop organization_quotas table
-- =============================================================================
-- Reverses migration 166.  No other table references organization_quotas.
-- Columns later added to this table by migrations 169/170 are removed by
-- their own rollbacks, which run before this one in the chain; dropping the
-- whole table here is safe either way.
-- =============================================================================

DROP TABLE IF EXISTS organization_quotas;
