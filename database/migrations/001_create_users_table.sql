-- Migration: 001_create_users_table
-- Description: Creates the users/employees table for system access and staff management

-- Temporarily disable FK checks: organization_id references organizations
-- which is created in a later migration (016). Safe — MySQL stores the FK
-- metadata now and enforces it once the referenced table exists.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this user belongs to; NULL = single-tenant deployment',
    first_name      VARCHAR(100)    NOT NULL,
    last_name       VARCHAR(100)    NOT NULL,
    email           VARCHAR(255)    NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,
    role            ENUM('admin', 'billing', 'support', 'technician') NOT NULL DEFAULT 'support',
    phone           VARCHAR(30)     NULL,
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    last_login_at   TIMESTAMP       NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_organization_id (organization_id),
    CONSTRAINT fk_users_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
