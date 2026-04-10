-- Migration: 068_create_sat_catalog_tables
-- Description: Creates six SAT catalog (catálogo) lookup tables sourced from the
--              official SAT CFDI 4.0 catalogs.  These tables are reference data
--              seeded in migration 069 and referenced by FK from cfdi_documents
--              and MX profile tables to avoid magic strings and enable validation.
--
--              Tables created:
--                sat_regimen_fiscal   — c_RegimenFiscal
--                sat_uso_cfdi         — c_UsoCFDI
--                sat_forma_pago       — c_FormaPago
--                sat_metodo_pago      — c_MetodoPago
--                sat_tipo_comprobante — c_TipoDeComprobante
--                sat_moneda           — c_Moneda (subset used by ISPs)

-- ------------------------------------------------------------
-- 1. Régimen Fiscal (fiscal regime codes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_regimen_fiscal (
    code        VARCHAR(3)      NOT NULL
                    COMMENT 'SAT c_RegimenFiscal code (e.g. 601, 612, 626)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    applies_to  ENUM('personal', 'company', 'both') NOT NULL DEFAULT 'both'
                    COMMENT 'Whether the regime applies to individuals, moral persons, or both',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_regimen_fiscal_applies_to (applies_to),
    KEY idx_sat_regimen_fiscal_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_RegimenFiscal — fiscal regime codes for CFDI 4.0';

-- ------------------------------------------------------------
-- 2. Uso CFDI (CFDI use codes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_uso_cfdi (
    code        VARCHAR(4)      NOT NULL
                    COMMENT 'SAT c_UsoCFDI code (e.g. G03, S01, P01)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    applies_to  ENUM('personal', 'company', 'both') NOT NULL DEFAULT 'both'
                    COMMENT 'Whether the use code applies to individuals, moral persons, or both',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_uso_cfdi_applies_to (applies_to),
    KEY idx_sat_uso_cfdi_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_UsoCFDI — permitted use codes for CFDI 4.0 receptor';

-- ------------------------------------------------------------
-- 3. Forma de Pago (payment form codes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_forma_pago (
    code        VARCHAR(2)      NOT NULL
                    COMMENT 'SAT c_FormaPago code (e.g. 01, 03, 28)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_forma_pago_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_FormaPago — how a payment was or will be made';

-- ------------------------------------------------------------
-- 4. Método de Pago (payment method codes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_metodo_pago (
    code        VARCHAR(3)      NOT NULL
                    COMMENT 'SAT c_MetodoPago code: PUE (pago en una sola exhibición) or PPD (pago en parcialidades o diferido)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_metodo_pago_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_MetodoPago — PUE or PPD payment timing';

-- ------------------------------------------------------------
-- 5. Tipo de Comprobante (document type codes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_tipo_comprobante (
    code        VARCHAR(1)      NOT NULL
                    COMMENT 'SAT c_TipoDeComprobante: I=ingreso, E=egreso, P=pago, T=traslado, N=nomina',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_tipo_comprobante_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_TipoDeComprobante — CFDI document type';

-- ------------------------------------------------------------
-- 6. Moneda (currency codes used in CFDI)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_moneda (
    code        VARCHAR(3)      NOT NULL
                    COMMENT 'ISO 4217 / SAT c_Moneda currency code (e.g. MXN, USD, EUR, XXX)',
    description VARCHAR(100)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    decimals    TINYINT UNSIGNED NOT NULL DEFAULT 2
                    COMMENT 'Number of decimal places allowed for amounts in this currency',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_moneda_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_Moneda — currencies accepted in CFDI 4.0';
