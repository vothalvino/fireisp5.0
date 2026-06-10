-- =============================================================================
-- Migration 192: client_groups + clients.client_group_id
-- =============================================================================
-- Implements isp-platform-features.md §1.1 "Family/account grouping (shared
-- billing, family plan)". A group ties several client accounts together:
--   • billing_mode = 'separate' — each member is invoiced individually.
--   • billing_mode = 'shared'   — the primary member is billed for the group.
-- The optional primary_client_id designates the account that owns shared
-- billing for the group.
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_groups (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED NULL
                          COMMENT 'Tenant organization this group belongs to; NULL = single-tenant deployment',
    name              VARCHAR(255)    NOT NULL COMMENT 'Group / family name',
    billing_mode      ENUM('separate', 'shared') NOT NULL DEFAULT 'separate'
                          COMMENT 'separate = each member billed individually; shared = primary member billed for all',
    primary_client_id BIGINT UNSIGNED NULL
                          COMMENT 'Member designated as the billing owner when billing_mode = shared',
    notes             TEXT            NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_client_groups_organization_id (organization_id),
    KEY idx_client_groups_primary_client_id (primary_client_id),
    KEY idx_client_groups_deleted_at (deleted_at),
    CONSTRAINT fk_client_groups_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_client_groups_primary_client FOREIGN KEY (primary_client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clients
    ADD COLUMN client_group_id BIGINT UNSIGNED NULL
        COMMENT 'Family/account group this client belongs to (see client_groups)'
        AFTER organization_id,
    ADD KEY idx_clients_client_group_id (client_group_id),
    ADD CONSTRAINT fk_clients_client_group FOREIGN KEY (client_group_id)
        REFERENCES client_groups (id) ON DELETE SET NULL ON UPDATE CASCADE;
