-- =============================================================================
-- Rollback 241: Drop DHCP integration tables
-- =============================================================================
-- Reverses migration 241. Drop child table before parent to satisfy FK
-- constraints (dhcp_static_reservations references dhcp_servers).
-- =============================================================================

DROP TABLE IF EXISTS `dhcp_static_reservations`;
DROP TABLE IF EXISTS `dhcp_servers`;
