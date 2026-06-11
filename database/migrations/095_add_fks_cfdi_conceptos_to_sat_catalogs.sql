-- Migration: 095_add_fks_cfdi_conceptos_to_sat_catalogs
-- Description: Adds foreign key constraints from cfdi_conceptos to the SAT
--              product/service and unit-of-measure catalog tables created in
--              migrations 080 and 081 respectively.
--
--              Fields constrained:
--                clave_prod_serv → sat_clave_prod_serv(code)
--                clave_unidad    → sat_clave_unidad(code)
--
--              This prevents invalid SAT product/service and unit codes from
--              being stored on CFDI line items, which would cause PAC rejection.

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- cfdi_conceptos: SAT catalog FKs (each guarded by constraint name so the
-- file is safe to re-run after a mid-file failure)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_095_add_cfdi_conceptos_sat_fks;
DELIMITER //
CREATE PROCEDURE migration_095_add_cfdi_conceptos_sat_fks()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_conceptos'
      AND CONSTRAINT_NAME         = 'fk_cfdi_conceptos_clave_prod_serv'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_conceptos
        ADD CONSTRAINT fk_cfdi_conceptos_clave_prod_serv
            FOREIGN KEY (clave_prod_serv) REFERENCES sat_clave_prod_serv (code)
            ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_conceptos'
      AND CONSTRAINT_NAME         = 'fk_cfdi_conceptos_clave_unidad'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_conceptos
        ADD CONSTRAINT fk_cfdi_conceptos_clave_unidad
            FOREIGN KEY (clave_unidad) REFERENCES sat_clave_unidad (code)
            ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_095_add_cfdi_conceptos_sat_fks();
DROP PROCEDURE IF EXISTS migration_095_add_cfdi_conceptos_sat_fks;

SET FOREIGN_KEY_CHECKS = 1;
