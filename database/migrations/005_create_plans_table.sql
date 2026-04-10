-- Migration: 005_create_plans_table
-- Description: Creates the plans table for internet service packages

-- Temporarily disable FK checks: organization_id references organizations
-- which is created in a later migration (016). Safe — MySQL stores the FK
-- metadata now and enforces it once the referenced table exists.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS plans (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this plan belongs to; NULL = single-tenant deployment',
    name            VARCHAR(255)    NOT NULL,
    description     TEXT            NULL,
    download_speed  INT UNSIGNED    NOT NULL COMMENT 'Speed in Mbps',
    upload_speed    INT UNSIGNED    NOT NULL COMMENT 'Speed in Mbps',
    price           DECIMAL(10, 2)  NOT NULL,
    billing_cycle   ENUM('monthly', 'quarterly', 'semi_annual', 'annual') NOT NULL DEFAULT 'monthly',
    burst_download  INT UNSIGNED    NULL COMMENT 'Burst download speed in Mbps',
    burst_upload    INT UNSIGNED    NULL COMMENT 'Burst upload speed in Mbps',
    contention      TINYINT UNSIGNED NULL COMMENT 'Contention ratio e.g. 10 means 10:1',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_plans_organization_id (organization_id),
    KEY idx_plans_status (status),
    CONSTRAINT fk_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
