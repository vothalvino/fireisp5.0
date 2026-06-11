-- =============================================================================
-- Rollback 267: Drop FTTH vendor capability and splitter tables
-- =============================================================================
-- Reverses migration 267.
-- Also drops the FK added to onu_details (last_provision_job_id).
-- =============================================================================

-- Remove FK added to onu_details first
DROP PROCEDURE IF EXISTS rollback_267_remove_onu_fk;
DELIMITER $$
CREATE PROCEDURE rollback_267_remove_onu_fk()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA    = DATABASE()
      AND TABLE_NAME      = 'onu_details'
      AND CONSTRAINT_NAME = 'fk_onu_details_provision_job'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE onu_details DROP FOREIGN KEY fk_onu_details_provision_job;
  END IF;
END$$
DELIMITER ;

CALL rollback_267_remove_onu_fk();
DROP PROCEDURE IF EXISTS rollback_267_remove_onu_fk;

DROP TABLE IF EXISTS `olt_splitters`;
DROP TABLE IF EXISTS `olt_vendor_capabilities`;
