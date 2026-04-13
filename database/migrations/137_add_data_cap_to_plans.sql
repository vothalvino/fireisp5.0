-- =============================================================================
-- Migration 137 — Add data cap column to plans
-- =============================================================================
-- Allows plans to define a monthly data cap in GB for usage-based billing.
-- NULL means unlimited (no cap).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_137_add_data_cap_to_plans;
DELIMITER //
CREATE PROCEDURE migration_137_add_data_cap_to_plans()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'data_cap_gb'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN data_cap_gb DECIMAL(10,2) NULL COMMENT 'Monthly data cap in GB, NULL = unlimited' AFTER upload_speed;
  END IF;
END //
DELIMITER ;
CALL migration_137_add_data_cap_to_plans();
DROP PROCEDURE IF EXISTS migration_137_add_data_cap_to_plans;
