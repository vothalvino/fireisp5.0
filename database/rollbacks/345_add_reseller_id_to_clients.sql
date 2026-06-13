-- Rollback: 345_add_reseller_id_to_clients
-- Removes reseller_id column added to clients in migration 345.

DROP PROCEDURE IF EXISTS rollback_345_remove_reseller_id;
DELIMITER //
CREATE PROCEDURE rollback_345_remove_reseller_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'reseller_id'
  ) THEN
    ALTER TABLE clients
      DROP FOREIGN KEY fk_clients_reseller,
      DROP KEY idx_clients_reseller_id,
      DROP COLUMN reseller_id;
  END IF;
END //
DELIMITER ;
CALL rollback_345_remove_reseller_id();
DROP PROCEDURE IF EXISTS rollback_345_remove_reseller_id;
