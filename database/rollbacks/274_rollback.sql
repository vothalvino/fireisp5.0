-- =============================================================================
-- Rollback 274: Remove CPE core tables (§8.1)
-- =============================================================================

DROP TABLE IF EXISTS cpe_tasks;
DROP TABLE IF EXISTS cpe_parameters;
DROP TABLE IF EXISTS cpe_devices;
