-- Migration: 067_create_organization_mx_profiles_table
-- Description: One-to-one Mexico extension for organizations.
--              Required (enforced at the app layer) when organizations.locale = 'MX'.
--              Stores the CSD digital seal certificate, PAC stamping credentials,
--              CFDI series/folio numbering, and SAT identity fields for the issuer
--              node of every CFDI document.
--
--              CSD private key is stored encrypted (csd_private_key_enc); the
--              application is responsible for encryption/decryption at rest.
--              PAC password is similarly encrypted (pac_password_enc).

-- Temporarily disable FK checks: organizations is created in migration 016.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS organization_mx_profiles (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'References organizations(id) — one profile per organization',

    -- SAT taxpayer identity
    rfc                     VARCHAR(13)     NOT NULL
                                COMMENT 'RFC of the ISP as the CFDI issuer',
    razon_social            VARCHAR(300)    NOT NULL
                                COMMENT 'Legal name of the ISP exactly as registered with SAT',
    regimen_fiscal          VARCHAR(3)      NOT NULL
                                COMMENT 'SAT fiscal regime code for the issuer (e.g. 601, 621)',
    codigo_postal_fiscal    VARCHAR(5)      NOT NULL
                                COMMENT 'Fiscal ZIP code of the ISP as registered with SAT',

    -- CSD (Certificado de Sello Digital) for signing CFDIs
    csd_certificate_number  VARCHAR(30)     NULL
                                COMMENT 'SAT-assigned certificate serial number',
    csd_certificate_pem     TEXT            NULL
                                COMMENT 'CSD public certificate in PEM format (.cer)',
    csd_private_key_enc     TEXT            NULL
                                COMMENT 'CSD private key encrypted at rest (.key) — app handles encryption',
    csd_valid_from          DATE            NULL
                                COMMENT 'CSD certificate validity start date',
    csd_valid_to            DATE            NULL
                                COMMENT 'CSD certificate expiry date — alerts should fire before this date',

    -- PAC (Proveedor Autorizado de Certificación) integration
    pac_provider            VARCHAR(50)     NULL
                                COMMENT 'PAC provider name (e.g. Finkok, TimbraSoft, SW Sapien)',
    pac_username            VARCHAR(255)    NULL
                                COMMENT 'PAC API username',
    pac_password_enc        VARCHAR(500)    NULL
                                COMMENT 'PAC API password encrypted at rest — app handles encryption',
    pac_environment         ENUM('sandbox', 'production') NOT NULL DEFAULT 'sandbox'
                                COMMENT 'sandbox = PAC test environment; production = live stamping',

    -- CFDI series & folio auto-numbering
    cfdi_serie_ingreso      VARCHAR(10)     NOT NULL DEFAULT 'A'
                                COMMENT 'Series prefix for CFDI tipo I (ingreso / invoice)',
    cfdi_serie_egreso       VARCHAR(10)     NOT NULL DEFAULT 'E'
                                COMMENT 'Series prefix for CFDI tipo E (egreso / credit note)',
    cfdi_serie_pago         VARCHAR(10)     NOT NULL DEFAULT 'P'
                                COMMENT 'Series prefix for CFDI tipo P (pago / payment complement)',
    cfdi_folio_next         BIGINT UNSIGNED NOT NULL DEFAULT 1
                                COMMENT 'Next available folio number — incremented atomically by the app on each issue',

    -- Mexican fiscal address
    colonia                 VARCHAR(150)    NULL
                                COMMENT 'Neighborhood',
    municipio               VARCHAR(150)    NULL
                                COMMENT 'Municipality',
    exterior_number         VARCHAR(20)     NULL
                                COMMENT 'Street exterior number',
    interior_number         VARCHAR(20)     NULL
                                COMMENT 'Suite / interior number',

    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_mx_profiles_org_id (organization_id),
    UNIQUE KEY uq_organization_mx_profiles_rfc (rfc),
    KEY idx_organization_mx_profiles_pac_environment (pac_environment),
    CONSTRAINT fk_organization_mx_profiles_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
