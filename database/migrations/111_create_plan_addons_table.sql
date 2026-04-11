-- Migration: 111_create_plan_addons_table
-- Description: Catalog of plan add-ons available for sale per organization.
--              Covers upsells such as static IP assignment, extra IP blocks,
--              additional bandwidth, and equipment rental. Prices and billing
--              cycles are defined here; contract-level assignments are in
--              contract_addons (migration 112).

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS plan_addons (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED  NOT NULL                     COMMENT 'Tenant organization that offers this add-on',
    name             VARCHAR(150)     NOT NULL                     COMMENT 'Display name, e.g. "IP Estática", "Renta de Router"',
    description      TEXT             NULL                         COMMENT 'Detailed description shown to billing agents or on the client portal',
    addon_type       ENUM('static_ip','extra_ip_block','extra_bandwidth','equipment_rental','other')
                                      NOT NULL                     COMMENT 'Category of add-on for reporting and processing logic',
    price            DECIMAL(10, 2)   NOT NULL                     COMMENT 'Base price per billing cycle',
    billing_cycle    ENUM('monthly','one_time','yearly')
                                      NOT NULL DEFAULT 'monthly'   COMMENT 'How often this add-on is charged',
    is_taxable       TINYINT(1)       NOT NULL DEFAULT 1           COMMENT 'TRUE = tax rules apply to this add-on''s price',
    status           ENUM('active','inactive')
                                      NOT NULL DEFAULT 'active'    COMMENT 'Availability status',
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_plan_addons_organization_id (organization_id),
    KEY idx_plan_addons_addon_type (addon_type),
    KEY idx_plan_addons_status (status),
    CONSTRAINT fk_plan_addons_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
