-- Migration: 110_create_organization_users_table
-- Description: Pivot table linking users to organizations with per-organization
--              roles. Allows a single user account to belong to multiple tenant
--              organizations with different permission levels in each.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS organization_users (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED  NOT NULL                                    COMMENT 'Organization this membership record belongs to',
    user_id          BIGINT UNSIGNED  NOT NULL                                    COMMENT 'User who is a member of this organization',
    role             ENUM('owner','admin','manager','technician','billing','readonly')
                                      NOT NULL DEFAULT 'readonly'                 COMMENT 'User role within this specific organization',
    is_primary_org   TINYINT(1)       NOT NULL DEFAULT 0                          COMMENT 'TRUE = this is the user''s primary/home organization',
    joined_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP          COMMENT 'When the user was added to the organization',
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_users_org_user (organization_id, user_id),
    KEY idx_organization_users_user_id (user_id),
    KEY idx_organization_users_role (role),
    CONSTRAINT fk_organization_users_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_organization_users_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
