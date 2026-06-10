-- Rollback 216: Remove suspension_exempt columns from clients

DROP PROCEDURE IF EXISTS rollback_216_remove_suspension_exempt_cols;
DELIMITER //
CREATE PROCEDURE rollback_216_remove_suspension_exempt_cols()
BEGIN
  -- Drop suspension_exempt_reason
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clients'
      AND COLUMN_NAME = 'suspension_exempt_reason'
  ) THEN
    ALTER TABLE clients DROP COLUMN suspension_exempt_reason;
  END IF;

  -- Drop suspension_exempt
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clients'
      AND COLUMN_NAME = 'suspension_exempt'
  ) THEN
    ALTER TABLE clients DROP COLUMN suspension_exempt;
  END IF;
END //
DELIMITER ;
CALL rollback_216_remove_suspension_exempt_cols();
DROP PROCEDURE IF EXISTS rollback_216_remove_suspension_exempt_cols;
