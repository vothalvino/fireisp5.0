-- Migration: 055_create_tax_rates_table
-- Description: Creates the tax_rates table — master list of named tax
--              configurations (e.g. "IVA 16%", "Exempt", "Sales Tax 8%").
--              Referenced by invoices, quotes, and credit notes via tax_rate_id
--              so that rate changes only need to happen in one place.

-- Temporarily disable FK checks: organization_id references organizations
-- which may not have been created yet in sequential migration runs.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS tax_rates (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = applies to all tenants',
    name            VARCHAR(100)     NOT NULL COMMENT 'Human-readable label, e.g. "IVA 16%", "Exempt", "GST 5%"',
    rate            DECIMAL(5, 4)    NOT NULL COMMENT 'Tax rate as a decimal, e.g. 0.1600 = 16%',
    description     TEXT             NULL     COMMENT 'Optional explanation or legal reference',
    is_default      BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'Default rate applied to new invoices/quotes when none is selected',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_tax_rates_organization_id (organization_id),
    KEY idx_tax_rates_status (status),
    KEY idx_tax_rates_is_default (is_default),
    CONSTRAINT fk_tax_rates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
