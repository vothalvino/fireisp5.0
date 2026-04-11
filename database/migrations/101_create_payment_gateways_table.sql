-- Migration: 101_create_payment_gateways_table
-- Description: Configuration table for payment gateway providers
--              (Stripe, Conekta, OpenPay, MercadoPago, PayPal, manual, etc.)
--              per organization. Stores environment, encrypted credentials,
--              webhook secrets, and provider-specific JSON config.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS payment_gateways (
    id                       BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id          BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization that owns this gateway config',
    name                     VARCHAR(100)     NOT NULL                    COMMENT 'Friendly label, e.g. "Conekta Producción"',
    provider                 ENUM('stripe','conekta','openpay','mercadopago','paypal','manual','other')
                                              NOT NULL                    COMMENT 'Payment provider identifier',
    environment              ENUM('sandbox','production')
                                              NOT NULL DEFAULT 'sandbox'  COMMENT 'Gateway environment',
    public_key               VARCHAR(500)     NULL                        COMMENT 'Provider public/publishable key (not secret)',
    secret_key_encrypted     TEXT             NOT NULL                    COMMENT 'Encrypted secret/private API key',
    webhook_secret_encrypted TEXT             NULL                        COMMENT 'Encrypted webhook signing secret',
    is_default               TINYINT(1)       NOT NULL DEFAULT 0          COMMENT 'TRUE = default gateway for this organization',
    status                   ENUM('active','inactive')
                                              NOT NULL DEFAULT 'active'   COMMENT 'Gateway status',
    config_json              JSON             NULL                        COMMENT 'Provider-specific extra settings (e.g. merchant IDs, endpoint overrides)',
    created_at               TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_payment_gateways_organization_id (organization_id),
    KEY idx_payment_gateways_provider (provider),
    KEY idx_payment_gateways_status (status),
    CONSTRAINT fk_payment_gateways_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
