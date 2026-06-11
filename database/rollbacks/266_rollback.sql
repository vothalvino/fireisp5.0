-- =============================================================================
-- Rollback 266: Drop FTTH OLT & ONU management tables
-- =============================================================================
-- Reverses migration 266. Drop child tables before parents to satisfy FK
-- constraints. onu_optical_metrics has no FKs (metrics pattern).
-- =============================================================================

DROP TABLE IF EXISTS `onu_firmware_jobs`;
DROP TABLE IF EXISTS `onu_omci_configs`;
DROP TABLE IF EXISTS `onu_whitelist`;
DROP TABLE IF EXISTS `onu_optical_metrics`;
DROP TABLE IF EXISTS `onu_details`;
DROP TABLE IF EXISTS `onu_profiles`;
DROP TABLE IF EXISTS `olt_ports`;
