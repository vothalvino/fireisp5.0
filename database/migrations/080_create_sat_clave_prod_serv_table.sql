-- Migration: 080_create_sat_clave_prod_serv_table
-- Description: Creates the SAT c_ClaveProdServ catalog table.  This table stores
--              the official SAT product and service classification codes required
--              on every concept (line item) in a CFDI 4.0 document.
--
--              The catalog is seeded with ISP-relevant codes in migration 082.
--              The full catalog (>50 000 entries) can be imported separately from
--              the official SAT publication.
--
--              Referenced by cfdi_conceptos.clave_prod_serv (created in 083).

CREATE TABLE IF NOT EXISTS sat_clave_prod_serv (
    code        VARCHAR(8)      NOT NULL
                    COMMENT 'SAT c_ClaveProdServ code (e.g. 81161700 for internet access services)',
    description VARCHAR(500)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
                    COMMENT 'Whether this code is currently valid in the SAT catalog',

    PRIMARY KEY (code),
    KEY idx_sat_clave_prod_serv_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_ClaveProdServ — product and service classification codes for CFDI 4.0 concepts';
