-- =============================================================================
-- Migration 344 — Reseller Hierarchy Tables (§19.1)
-- =============================================================================
-- Creates the resellers table (self-referencing hierarchy) and supporting tables:
--   resellers               — ISP → Master Reseller → Sub-Reseller hierarchy
--   reseller_plan_prices    — per-reseller plan price overrides
--   reseller_commissions    — commission earnings records per reseller/invoice
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Table: resellers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resellers (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'Tenant organization; NULL = single-tenant',
    parent_id           BIGINT UNSIGNED NULL     COMMENT 'NULL = top-level (Master Reseller); non-null = Sub-Reseller',
    level               TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1=Master Reseller, 2=Sub-Reseller (max depth)',
    name                VARCHAR(255)    NOT NULL,
    email               VARCHAR(255)    NULL,
    phone               VARCHAR(30)     NULL,
    contact_name        VARCHAR(255)    NULL,
    status              ENUM('active', 'suspended', 'inactive') NOT NULL DEFAULT 'active',
    commission_rate     DECIMAL(5, 2)  NOT NULL DEFAULT 0.00 COMMENT 'Commission percentage (0.00-100.00)',
    -- White-label branding
    brand_logo_url      VARCHAR(500)    NULL     COMMENT 'Logo URL for white-label portal',
    brand_primary_color VARCHAR(7)      NULL     COMMENT 'CSS hex color e.g. #1a5276',
    brand_accent_color  VARCHAR(7)      NULL     COMMENT 'CSS hex accent color',
    portal_domain       VARCHAR(255)    NULL     COMMENT 'Custom domain for this reseller portal',
    portal_name         VARCHAR(255)    NULL     COMMENT 'Portal product name shown to end subscribers',
    -- Notes
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_resellers_organization_id (organization_id),
    KEY idx_resellers_parent_id (parent_id),
    KEY idx_resellers_status (status),
    KEY idx_resellers_deleted_at (deleted_at),
    CONSTRAINT fk_resellers_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_resellers_parent FOREIGN KEY (parent_id)
        REFERENCES resellers (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: reseller_plan_prices
-- Custom plan price overrides per reseller (wholesale pricing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reseller_plan_prices (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reseller_id     BIGINT UNSIGNED NOT NULL,
    plan_id         BIGINT UNSIGNED NOT NULL,
    custom_price    DECIMAL(12, 2)  NOT NULL COMMENT 'Price reseller charges their customers',
    currency        VARCHAR(3)      NOT NULL DEFAULT 'USD',
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_reseller_plan_prices (reseller_id, plan_id),
    KEY idx_reseller_plan_prices_reseller_id (reseller_id),
    KEY idx_reseller_plan_prices_plan_id (plan_id),
    CONSTRAINT fk_rpp_reseller FOREIGN KEY (reseller_id)
        REFERENCES resellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_rpp_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: reseller_commissions
-- Tracks commission earnings per reseller per invoice
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reseller_commissions (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reseller_id     BIGINT UNSIGNED NOT NULL,
    invoice_id      BIGINT UNSIGNED NOT NULL,
    client_id       BIGINT UNSIGNED NOT NULL,
    commission_rate DECIMAL(5, 2)   NOT NULL COMMENT 'Rate applied at time of invoice',
    invoice_total   DECIMAL(12, 2)  NOT NULL,
    commission_amount DECIMAL(12, 2) NOT NULL COMMENT 'Computed: invoice_total * commission_rate / 100',
    currency        VARCHAR(3)      NOT NULL DEFAULT 'USD',
    status          ENUM('pending', 'approved', 'paid', 'cancelled') NOT NULL DEFAULT 'pending',
    paid_at         DATETIME        NULL,
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_reseller_commissions (reseller_id, invoice_id),
    KEY idx_reseller_commissions_reseller_id (reseller_id),
    KEY idx_reseller_commissions_invoice_id (invoice_id),
    KEY idx_reseller_commissions_client_id (client_id),
    KEY idx_reseller_commissions_status (status),
    CONSTRAINT fk_rc_reseller FOREIGN KEY (reseller_id)
        REFERENCES resellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_rc_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_rc_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
