-- Rollback for migration 374 — revert audit_logs repairs.
-- Drops organization_id and narrows action back to the original ENUM. Rows with
-- an action value outside the ENUM would be truncated on downgrade; this is a
-- best-effort structural reversal.
DROP PROCEDURE IF EXISTS rollback_374_fix_audit_logs;
DELIMITER //
CREATE PROCEDURE rollback_374_fix_audit_logs()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND CONSTRAINT_NAME = 'fk_audit_logs_org'
  ) THEN
    ALTER TABLE audit_logs DROP FOREIGN KEY fk_audit_logs_org;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE audit_logs DROP KEY idx_audit_logs_org, DROP COLUMN organization_id;
  END IF;
  ALTER TABLE audit_logs
    MODIFY COLUMN action ENUM('create','update','delete','login','logout','export','other') NOT NULL;
END //
DELIMITER ;
CALL rollback_374_fix_audit_logs();
DROP PROCEDURE IF EXISTS rollback_374_fix_audit_logs;
