-- =============================================================================
-- Rollback 275: Remove CPE profiles and firmware tables (§8.1/§8.2)
-- =============================================================================

DROP TABLE IF EXISTS cpe_firmware_campaigns;
DROP TABLE IF EXISTS cpe_firmware_versions;
DROP TABLE IF EXISTS cpe_parameter_mappings;
DROP TABLE IF EXISTS cpe_profiles;
