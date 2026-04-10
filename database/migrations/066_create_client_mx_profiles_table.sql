-- Migration: 066_create_client_mx_profiles_table
-- Description: One-to-one Mexico extension for clients.
--              Required (enforced at the app layer) when clients.locale = 'MX'.
--              Stores SAT-specific identity fields that CFDI 4.0 mandates on
--              every fiscal document: RFC, razon_social, regimen_fiscal, and
--              codigo_postal_fiscal must match the SAT taxpayer registry exactly.
--
--              This is a separate table rather than nullable columns on clients so
--              that the base clients table stays lean for global deployments.

-- Temporarily disable FK checks: clients is created in migration 002.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS client_mx_profiles (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id               BIGINT UNSIGNED NOT NULL
                                COMMENT 'References clients(id) — one profile per client',
    rfc                     VARCHAR(13)     NOT NULL
                                COMMENT 'Registro Federal de Contribuyentes — 12 chars for companies, 13 for individuals',
    curp                    VARCHAR(18)     NULL
                                COMMENT 'Clave Única de Registro de Población — personal clients only',
    razon_social            VARCHAR(300)    NOT NULL
                                COMMENT 'Legal name exactly as registered with SAT — must match for CFDI validation',
    regimen_fiscal          VARCHAR(3)      NOT NULL
                                COMMENT 'SAT fiscal regime code from c_RegimenFiscal (e.g. 601, 612, 626)',
    codigo_postal_fiscal    VARCHAR(5)      NOT NULL
                                COMMENT 'Fiscal ZIP code as registered with SAT — required on CFDI 4.0 receptor node',
    uso_cfdi_default        VARCHAR(4)      NULL
                                COMMENT 'Default CFDI use code from c_UsoCFDI (e.g. G03, S01) — pre-filled on new invoices',
    colonia                 VARCHAR(150)    NULL
                                COMMENT 'Neighborhood — required for Mexican addresses on CFDI',
    municipio               VARCHAR(150)    NULL
                                COMMENT 'Municipality — required for Mexican addresses on CFDI',
    exterior_number         VARCHAR(20)     NULL
                                COMMENT 'Street exterior number',
    interior_number         VARCHAR(20)     NULL
                                COMMENT 'Suite / interior number',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_client_mx_profiles_client_id (client_id),
    UNIQUE KEY uq_client_mx_profiles_rfc (rfc),
    KEY idx_client_mx_profiles_regimen_fiscal (regimen_fiscal),
    CONSTRAINT fk_client_mx_profiles_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
