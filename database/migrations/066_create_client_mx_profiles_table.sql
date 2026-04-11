-- Migration: 066_create_client_mx_profiles_table
-- Description: One-to-one Mexico extension for clients.
--              Required (enforced at the app layer) when clients.locale = 'MX'.
--              Stores SAT-specific identity fields that CFDI 4.0 mandates on
--              every fiscal document: RFC, razon_social, regimen_fiscal, and
--              codigo_postal_fiscal must match the SAT taxpayer registry exactly.
--
--              This is a separate table rather than nullable columns on clients so
--              that the base clients table stays lean for global deployments.
--
--              Venta al público en general:
--              When requires_cfdi = FALSE the client does not receive individual
--              CFDIs.  Instead, their invoices are aggregated into periodic CFDI
--              Global documents (Factura Global).  The RFC for these clients is
--              the SAT-defined generic RFC XAXX010101000.  A stored generated
--              column (rfc_unique_check) allows multiple público-en-general
--              clients to share that RFC while still enforcing uniqueness for
--              all other RFCs (NULL values are ignored by the UNIQUE constraint).

-- Temporarily disable FK checks: clients is created in migration 002.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS client_mx_profiles (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id               BIGINT UNSIGNED NOT NULL
                                COMMENT 'References clients(id) — one profile per client',
    rfc                     VARCHAR(13)     NOT NULL
                                COMMENT 'Registro Federal de Contribuyentes — 12 chars for companies, 13 for individuals; XAXX010101000 for público en general',
    requires_cfdi           BOOLEAN         NOT NULL DEFAULT TRUE
                                COMMENT 'TRUE = client receives individual CFDIs; FALSE = sales go to CFDI Global (público en general, RFC XAXX010101000)',
    rfc_unique_check        VARCHAR(13)     AS (CASE WHEN rfc = 'XAXX010101000' THEN NULL ELSE rfc END) STORED
                                COMMENT 'Generated column for conditional uniqueness — NULL for público en general (allows duplicates), non-NULL for real RFCs (enforces uniqueness)',
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
    UNIQUE KEY uq_client_mx_profiles_rfc (rfc_unique_check),
    KEY idx_client_mx_profiles_rfc (rfc),
    KEY idx_client_mx_profiles_regimen_fiscal (regimen_fiscal),
    KEY idx_client_mx_profiles_requires_cfdi (requires_cfdi),
    CONSTRAINT fk_client_mx_profiles_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,

    -- When requires_cfdi is FALSE, RFC must be the SAT generic público en general RFC
    CONSTRAINT chk_client_mx_profiles_publico_general CHECK (
        requires_cfdi = TRUE OR rfc = 'XAXX010101000'
    ),
    -- When RFC is the SAT generic RFC, requires_cfdi must be FALSE
    CONSTRAINT chk_client_mx_profiles_generic_rfc CHECK (
        rfc != 'XAXX010101000' OR requires_cfdi = FALSE
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
