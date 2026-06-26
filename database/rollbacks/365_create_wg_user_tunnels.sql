-- Rollback: 365_create_wg_user_tunnels
-- Drops the wg_user_peers and user_network_assignments tables added in migration 365.
-- Permission rows and role_permissions rows are left in place (they are harmless
-- without the tables; removing them risks breaking existing installs that may have
-- partial data).
DROP TABLE IF EXISTS user_network_assignments;
DROP TABLE IF EXISTS wg_user_peers;
