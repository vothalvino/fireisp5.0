-- Migration: 016_create_organizations_table
-- Description: Creates the organizations table for ISP company/tenant settings

CREATE TABLE IF NOT EXISTS organizations (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                VARCHAR(255)    NOT NULL,
    legal_name          VARCHAR(255)    NULL,
    tax_id              VARCHAR(50)     NULL COMMENT 'SAT / tax-authority registration number',
    email               VARCHAR(255)    NULL,
    phone               VARCHAR(30)     NULL,
    address             VARCHAR(255)    NULL,
    city                VARCHAR(100)    NULL,
    state               VARCHAR(100)    NULL,
    country             VARCHAR(100)    NULL DEFAULT 'US',
    zip_code            VARCHAR(20)     NULL,
    website             VARCHAR(255)    NULL,
    online_payment_url  VARCHAR(255)    NULL COMMENT 'URL for the online payment portal',
    map_url             VARCHAR(500)    NULL COMMENT 'URL or embed link for office/coverage map',
    notes               TEXT            NULL,
    status              ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_organizations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
