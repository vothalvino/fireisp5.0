-- =============================================================================
-- Rollback 237: Remove pppoe_service_profiles table and service_profile_id columns
-- =============================================================================
-- Reverses migration 237. Drop order:
--   1. Drop FK + column from radius table.
--   2. Drop FK + column from ip_pools table.
--   3. Drop pppoe_service_profiles table (must be last — referenced by FKs above).
-- All ALTER operations use stored-procedure guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop FK: fk_radius_service_profile
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_237_drop_fk_radius_service_profile;
DELIMITER //
CREATE PROCEDURE rollback_237_drop_fk_radius_service_profile()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'radius'
      AND CONSTRAINT_NAME         = 'fk_radius_service_profile'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE radius DROP FOREIGN KEY fk_radius_service_profile;
  END IF;
END //
DELIMITER ;
CALL rollback_237_drop_fk_radius_service_profile();
DROP PROCEDURE IF EXISTS rollback_237_drop_fk_radius_service_profile;

-- ---------------------------------------------------------------------------
-- Drop column: radius.service_profile_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_237_drop_radius_service_profile_id;
DELIMITER //
CREATE PROCEDURE rollback_237_drop_radius_service_profile_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'service_profile_id'
  ) THEN
    ALTER TABLE radius DROP COLUMN service_profile_id;
  END IF;
END //
DELIMITER ;
CALL rollback_237_drop_radius_service_profile_id();
DROP PROCEDURE IF EXISTS rollback_237_drop_radius_service_profile_id;

-- ---------------------------------------------------------------------------
-- Drop FK: fk_ip_pools_service_profile
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_237_drop_fk_ip_pools_service_profile;
DELIMITER //
CREATE PROCEDURE rollback_237_drop_fk_ip_pools_service_profile()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'ip_pools'
      AND CONSTRAINT_NAME         = 'fk_ip_pools_service_profile'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE ip_pools DROP FOREIGN KEY fk_ip_pools_service_profile;
  END IF;
END //
DELIMITER ;
CALL rollback_237_drop_fk_ip_pools_service_profile();
DROP PROCEDURE IF EXISTS rollback_237_drop_fk_ip_pools_service_profile;

-- ---------------------------------------------------------------------------
-- Drop column: ip_pools.service_profile_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_237_drop_ip_pools_service_profile_id;
DELIMITER //
CREATE PROCEDURE rollback_237_drop_ip_pools_service_profile_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'service_profile_id'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN service_profile_id;
  END IF;
END //
DELIMITER ;
CALL rollback_237_drop_ip_pools_service_profile_id();
DROP PROCEDURE IF EXISTS rollback_237_drop_ip_pools_service_profile_id;

-- ---------------------------------------------------------------------------
-- Drop table: pppoe_service_profiles
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS pppoe_service_profiles;
