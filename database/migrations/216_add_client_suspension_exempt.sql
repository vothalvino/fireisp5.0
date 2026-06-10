-- =============================================================================
-- Migration 216: Add suspension_exempt columns to clients table
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_216_add_client_suspension_exempt;
DELIMITER //
CREATE PROCEDURE migration_216_add_client_suspension_exempt()
BEGIN
  -- suspension_exempt
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clients'
      AND COLUMN_NAME = 'suspension_exempt'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN suspension_exempt TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'When 1, suspension rules will never be applied to this client';
  END IF;

  -- suspension_exempt_reason
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clients'
      AND COLUMN_NAME = 'suspension_exempt_reason'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN suspension_exempt_reason VARCHAR(500) NULL
        COMMENT 'Optional explanation for why this client is exempt from suspension' AFTER suspension_exempt;
  END IF;
END //
DELIMITER ;
CALL migration_216_add_client_suspension_exempt();
DROP PROCEDURE IF EXISTS migration_216_add_client_suspension_exempt;
