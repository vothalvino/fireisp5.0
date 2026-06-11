-- =============================================================================
-- Migration 249: Device Groups and Device Group Members
-- =============================================================================
-- Implements isp-platform-features.md §6.1 "SNMP Discovery":
--   Creates device_groups for logical grouping of devices (by type, location,
--   region, OLT, or custom), and the device_group_members junction table.
--
-- Tables created:
--   device_groups        — org-scoped device group definitions
--   device_group_members — junction table linking groups to devices
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: device_groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_groups (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    name            VARCHAR(200)    NOT NULL,
    description     TEXT            NULL,
    group_type      ENUM('type','location','region','olt','custom') NOT NULL DEFAULT 'custom'
                                             COMMENT 'Grouping criterion',
    color           VARCHAR(7)      NULL     COMMENT 'Hex color for UI display',
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_device_groups_org_name (organization_id, name),
    KEY idx_device_groups_organization_id (organization_id),
    KEY idx_device_groups_status (status),
    KEY idx_device_groups_deleted_at (deleted_at),
    CONSTRAINT fk_device_groups_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: device_group_members
-- Junction table — no soft-delete, no org column.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_group_members (
    device_group_id BIGINT UNSIGNED NOT NULL,
    device_id       BIGINT UNSIGNED NOT NULL,
    added_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (device_group_id, device_id),
    KEY idx_dgm_device_id (device_id),
    CONSTRAINT fk_dgm_group FOREIGN KEY (device_group_id)
        REFERENCES device_groups (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dgm_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
