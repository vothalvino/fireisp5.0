-- Migration: 078_add_mx_template_to_contracts
-- Description: Links each contract to an IFT/CRT-registered Carta de Adhesión
--              template (created in migration 077).
--
--              NULL = global client / no registered template required.
--              Populated = MX client; the app can enforce that a registered
--              template is selected before the contract is activated.
--
--              Column / key / FK additions use stored-procedure IF NOT EXISTS
--              guards so the file is safe to re-run after a mid-file failure.

-- Disable FK checks: contract_templates_mx is created in migration 077.
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- contracts: contract_template_mx_id column + key + FK
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_078_add_contracts_template_mx;
DELIMITER //
CREATE PROCEDURE migration_078_add_contracts_template_mx()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'contract_template_mx_id'
  ) THEN
    ALTER TABLE contracts
        ADD COLUMN contract_template_mx_id BIGINT UNSIGNED NULL
            COMMENT 'IFT/CRT-registered Carta de Adhesión template used for this contract; NULL for global clients'
            AFTER connection_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND INDEX_NAME   = 'idx_contracts_contract_template_mx_id'
  ) THEN
    ALTER TABLE contracts
        ADD KEY idx_contracts_contract_template_mx_id (contract_template_mx_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'contracts'
      AND CONSTRAINT_NAME         = 'fk_contracts_contract_template_mx'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE contracts
        ADD CONSTRAINT fk_contracts_contract_template_mx
            FOREIGN KEY (contract_template_mx_id)
            REFERENCES contract_templates_mx (id)
            ON DELETE SET NULL
            ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_078_add_contracts_template_mx();
DROP PROCEDURE IF EXISTS migration_078_add_contracts_template_mx;

SET FOREIGN_KEY_CHECKS = 1;
