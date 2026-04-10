-- Migration: 044_create_tax_rules_table
-- Description: Tax rules per region and service type. Supports VAT, sales tax,
--              GST, and other regional tax configurations. Each rule can be
--              scoped to a specific organization for multi-tenant deployments.

-- Temporarily disable FK checks: organization_id references organizations
-- which may not have been applied yet in sequential migration runs.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS tax_rules (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = applies to all tenants',
    name            VARCHAR(255)     NOT NULL,
    region          VARCHAR(100)     NULL     COMMENT 'State, province, or country the rule applies to',
    tax_type        ENUM('vat', 'sales_tax', 'gst', 'other') NOT NULL DEFAULT 'sales_tax',
    rate            DECIMAL(5, 4)    NOT NULL COMMENT 'Tax rate as a decimal, e.g. 0.0800 = 8%',
    is_default      BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'Default rule applied when no region match is found',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_tax_rules_organization_id (organization_id),
    KEY idx_tax_rules_region (region),
    KEY idx_tax_rules_status (status),
    CONSTRAINT fk_tax_rules_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
