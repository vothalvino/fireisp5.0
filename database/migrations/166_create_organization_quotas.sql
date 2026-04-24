-- =============================================================================
-- Migration 166 — Per-tenant resource quotas
-- =============================================================================
-- Creates the `organization_quotas` table that stores optional upper bounds for
-- the four trackable resources per organization:
--   • max_clients           — active (non-deleted) client records
--   • max_devices           — active device records
--   • max_storage_mb        — sum of file_size across all org-owned files (MB)
--   • max_scheduled_tasks   — active scheduled_tasks rows scoped to the org
--
-- NULL in any limit column means "unlimited" for that resource.
-- A row is only created for an org when a quota is first configured; the
-- absence of a row is also treated as "unlimited".
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_quotas (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL,
    max_clients           INT UNSIGNED     NULL     COMMENT 'Max active clients; NULL = unlimited',
    max_devices           INT UNSIGNED     NULL     COMMENT 'Max active devices; NULL = unlimited',
    max_storage_mb        INT UNSIGNED     NULL     COMMENT 'Max total file storage in MB; NULL = unlimited',
    max_scheduled_tasks   INT UNSIGNED     NULL     COMMENT 'Max org-scoped scheduled tasks; NULL = unlimited',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_quotas_org (organization_id),
    CONSTRAINT fk_organization_quotas_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE
);
