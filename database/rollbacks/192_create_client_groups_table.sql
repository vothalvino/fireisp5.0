-- =============================================================================
-- FireISP 5.0 — Rollback 192: Drop client_groups + clients.client_group_id
-- =============================================================================
-- Reverses migration 192. The FK/column on clients must be removed before the
-- referenced client_groups table can be dropped.
-- =============================================================================

ALTER TABLE clients
    DROP FOREIGN KEY fk_clients_client_group;

ALTER TABLE clients
    DROP KEY idx_clients_client_group_id,
    DROP COLUMN client_group_id;

DROP TABLE IF EXISTS client_groups;
