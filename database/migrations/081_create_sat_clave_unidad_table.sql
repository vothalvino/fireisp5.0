-- Migration: 081_create_sat_clave_unidad_table
-- Description: Creates the SAT c_ClaveUnidad catalog table.  This table stores
--              the official SAT unit-of-measure codes required on every concept
--              (line item) in a CFDI 4.0 document.
--
--              The catalog is seeded with ISP-relevant codes in migration 082.
--
--              Referenced by cfdi_conceptos.clave_unidad (created in 083).

CREATE TABLE IF NOT EXISTS sat_clave_unidad (
    code        VARCHAR(10)     NOT NULL
                    COMMENT 'SAT c_ClaveUnidad code (e.g. E48 for service unit, H87 for piece)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish and/or English',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
                    COMMENT 'Whether this code is currently valid in the SAT catalog',

    PRIMARY KEY (code),
    KEY idx_sat_clave_unidad_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_ClaveUnidad — unit-of-measure codes for CFDI 4.0 concepts';
