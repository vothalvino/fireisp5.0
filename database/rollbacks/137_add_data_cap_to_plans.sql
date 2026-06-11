-- =============================================================================
-- FireISP 5.0 — Rollback 137: Remove data_cap_gb column from plans
-- =============================================================================
-- Reverses migration 137.
--
-- MySQL 8 does not support DROP COLUMN IF EXISTS, so the drop is guarded by
-- an INFORMATION_SCHEMA check inside a stored procedure.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_137_drop_data_cap_gb;
DELIMITER //
CREATE PROCEDURE rollback_137_drop_data_cap_gb()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'data_cap_gb'
  ) THEN
    ALTER TABLE plans DROP COLUMN data_cap_gb;
  END IF;
END //
DELIMITER ;
CALL rollback_137_drop_data_cap_gb();
DROP PROCEDURE IF EXISTS rollback_137_drop_data_cap_gb;
