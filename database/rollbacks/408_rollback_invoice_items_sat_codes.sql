-- Rollback for migration 408 — drop the per-line SAT catalog code columns.
DROP PROCEDURE IF EXISTS rollback_408_invoice_items_sat_codes;
DELIMITER //
CREATE PROCEDURE rollback_408_invoice_items_sat_codes()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoice_items'
      AND COLUMN_NAME  = 'clave_prod_serv'
  ) THEN
    ALTER TABLE invoice_items
      DROP COLUMN clave_prod_serv,
      DROP COLUMN clave_unidad;
  END IF;
END //
DELIMITER ;
CALL rollback_408_invoice_items_sat_codes();
DROP PROCEDURE IF EXISTS rollback_408_invoice_items_sat_codes;
