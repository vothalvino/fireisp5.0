-- Migration: 107_create_pac_providers_table
-- Description: PAC (Proveedor Autorizado de Certificación) provider credentials
--              and endpoint configuration per organization. Supports multiple PAC
--              vendors (Finkok, SW Sapien, Digicel, Comercio Digital, FacturAPI)
--              with sandbox/production environments and encrypted credentials.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS pac_providers (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL                     COMMENT 'Tenant organization that owns this PAC config',
    provider_name         ENUM('finkok','sw_sapien','digicel','comercio_digital','facturapi','other')
                                           NOT NULL                     COMMENT 'PAC vendor identifier',
    label                 VARCHAR(100)     NOT NULL                     COMMENT 'Friendly name, e.g. "Finkok Producción"',
    environment           ENUM('sandbox','production')
                                           NOT NULL DEFAULT 'sandbox'   COMMENT 'PAC environment',
    api_url               VARCHAR(500)     NOT NULL                     COMMENT 'Base URL for the PAC API endpoint',
    username_encrypted    VARCHAR(500)     NULL                         COMMENT 'Encrypted PAC account username (if applicable)',
    password_encrypted    VARCHAR(500)     NULL                         COMMENT 'Encrypted PAC account password (if applicable)',
    api_key_encrypted     VARCHAR(500)     NULL                         COMMENT 'Encrypted API key (if applicable)',
    token_encrypted       TEXT             NULL                         COMMENT 'Encrypted bearer token or JWT (if applicable)',
    is_default            TINYINT(1)       NOT NULL DEFAULT 0           COMMENT 'TRUE = default PAC for this organization',
    status                ENUM('active','inactive')
                                           NOT NULL DEFAULT 'active'    COMMENT 'PAC config status',
    last_stamp_at         TIMESTAMP        NULL                         COMMENT 'Timestamp of the most recent successful stamp via this PAC',
    last_error            TEXT             NULL                         COMMENT 'Last error message received from the PAC',
    config_json           JSON             NULL                         COMMENT 'Provider-specific extra settings (timeouts, wsdl overrides, etc.)',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_pac_providers_org_provider_env (organization_id, provider_name, environment),
    KEY idx_pac_providers_organization_id (organization_id),
    KEY idx_pac_providers_status (status),
    CONSTRAINT fk_pac_providers_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
