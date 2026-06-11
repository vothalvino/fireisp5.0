-- Migration: 094_add_fks_cfdi_documents_to_sat_catalogs
-- Description: Adds foreign key constraints from cfdi_documents to the SAT
--              catalog tables created in migration 068.
--
--              Fields constrained:
--                tipo_comprobante → sat_tipo_comprobante(code)
--                uso_cfdi         → sat_uso_cfdi(code)
--                metodo_pago      → sat_metodo_pago(code)   (NULLable — FK still valid)
--                forma_pago       → sat_forma_pago(code)    (NULLable — FK still valid)
--                moneda           → sat_moneda(code)
--
--              This prevents invalid SAT codes from being stored and keeps the
--              database consistent with the SAT CFDI 4.0 catalogs.

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- cfdi_documents: SAT catalog FKs (each guarded by constraint name so the
-- file is safe to re-run after a mid-file failure)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_094_add_cfdi_documents_sat_fks;
DELIMITER //
CREATE PROCEDURE migration_094_add_cfdi_documents_sat_fks()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_documents'
      AND CONSTRAINT_NAME         = 'fk_cfdi_documents_tipo_comprobante'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_documents
        ADD CONSTRAINT fk_cfdi_documents_tipo_comprobante
            FOREIGN KEY (tipo_comprobante) REFERENCES sat_tipo_comprobante (code)
            ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_documents'
      AND CONSTRAINT_NAME         = 'fk_cfdi_documents_uso_cfdi'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_documents
        ADD CONSTRAINT fk_cfdi_documents_uso_cfdi
            FOREIGN KEY (uso_cfdi) REFERENCES sat_uso_cfdi (code)
            ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_documents'
      AND CONSTRAINT_NAME         = 'fk_cfdi_documents_metodo_pago'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_documents
        ADD CONSTRAINT fk_cfdi_documents_metodo_pago
            FOREIGN KEY (metodo_pago) REFERENCES sat_metodo_pago (code)
            ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_documents'
      AND CONSTRAINT_NAME         = 'fk_cfdi_documents_forma_pago'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_documents
        ADD CONSTRAINT fk_cfdi_documents_forma_pago
            FOREIGN KEY (forma_pago) REFERENCES sat_forma_pago (code)
            ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_documents'
      AND CONSTRAINT_NAME         = 'fk_cfdi_documents_moneda'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_documents
        ADD CONSTRAINT fk_cfdi_documents_moneda
            FOREIGN KEY (moneda) REFERENCES sat_moneda (code)
            ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_094_add_cfdi_documents_sat_fks();
DROP PROCEDURE IF EXISTS migration_094_add_cfdi_documents_sat_fks;

SET FOREIGN_KEY_CHECKS = 1;
