-- =============================================================================
-- Rollback 232: Remove NAS registry enhancement columns and constraints
-- =============================================================================
-- Reverses migration 232. Drop order:
--   1. Drop FK constraints first (they reference the columns being removed).
--   2. Drop indexes.
--   3. Drop columns.
-- All operations use stored-procedure guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop FK: fk_nas_secondary
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_232_drop_fk_nas_secondary;
DELIMITER //
CREATE PROCEDURE rollback_232_drop_fk_nas_secondary()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA      = DATABASE()
      AND TABLE_NAME        = 'nas'
      AND CONSTRAINT_NAME   = 'fk_nas_secondary'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE nas DROP FOREIGN KEY fk_nas_secondary;
  END IF;
END //
DELIMITER ;
CALL rollback_232_drop_fk_nas_secondary();
DROP PROCEDURE IF EXISTS rollback_232_drop_fk_nas_secondary;

-- ---------------------------------------------------------------------------
-- Drop FK: fk_nas_site
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_232_drop_fk_nas_site;
DELIMITER //
CREATE PROCEDURE rollback_232_drop_fk_nas_site()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA      = DATABASE()
      AND TABLE_NAME        = 'nas'
      AND CONSTRAINT_NAME   = 'fk_nas_site'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE nas DROP FOREIGN KEY fk_nas_site;
  END IF;
END //
DELIMITER ;
CALL rollback_232_drop_fk_nas_site();
DROP PROCEDURE IF EXISTS rollback_232_drop_fk_nas_site;

-- ---------------------------------------------------------------------------
-- Drop index: idx_nas_secondary_nas_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_232_drop_idx_nas_secondary_nas_id;
DELIMITER //
CREATE PROCEDURE rollback_232_drop_idx_nas_secondary_nas_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'idx_nas_secondary_nas_id'
  ) THEN
    ALTER TABLE nas DROP INDEX idx_nas_secondary_nas_id;
  END IF;
END //
DELIMITER ;
CALL rollback_232_drop_idx_nas_secondary_nas_id();
DROP PROCEDURE IF EXISTS rollback_232_drop_idx_nas_secondary_nas_id;

-- ---------------------------------------------------------------------------
-- Drop index: idx_nas_site_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_232_drop_idx_nas_site_id;
DELIMITER //
CREATE PROCEDURE rollback_232_drop_idx_nas_site_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'idx_nas_site_id'
  ) THEN
    ALTER TABLE nas DROP INDEX idx_nas_site_id;
  END IF;
END //
DELIMITER ;
CALL rollback_232_drop_idx_nas_site_id();
DROP PROCEDURE IF EXISTS rollback_232_drop_idx_nas_site_id;

-- ---------------------------------------------------------------------------
-- Drop columns: last_health_check_at, health_status, secondary_nas_id,
--               site_id, location, coa_port
-- (Reversed order of addition for clean dependency resolution.)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_232_drop_nas_cols;
DELIMITER //
CREATE PROCEDURE rollback_232_drop_nas_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas' AND COLUMN_NAME = 'last_health_check_at'
  ) THEN
    ALTER TABLE nas DROP COLUMN last_health_check_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas' AND COLUMN_NAME = 'health_status'
  ) THEN
    ALTER TABLE nas DROP COLUMN health_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas' AND COLUMN_NAME = 'secondary_nas_id'
  ) THEN
    ALTER TABLE nas DROP COLUMN secondary_nas_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas' AND COLUMN_NAME = 'site_id'
  ) THEN
    ALTER TABLE nas DROP COLUMN site_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas' AND COLUMN_NAME = 'location'
  ) THEN
    ALTER TABLE nas DROP COLUMN location;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas' AND COLUMN_NAME = 'coa_port'
  ) THEN
    ALTER TABLE nas DROP COLUMN coa_port;
  END IF;
END //
DELIMITER ;
CALL rollback_232_drop_nas_cols();
DROP PROCEDURE IF EXISTS rollback_232_drop_nas_cols;
