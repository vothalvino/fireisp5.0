-- =============================================================================
-- Rollback 235: Remove ip_pools PPPoE enhancement columns and constraints
-- =============================================================================
-- Reverses migration 235. Drop order:
--   1. Drop FK constraint first (references the column being removed).
--   2. Drop index.
--   3. Drop columns (reverse order of addition).
-- All operations use stored-procedure guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop FK: fk_ip_pools_nas
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_235_drop_fk_ip_pools_nas;
DELIMITER //
CREATE PROCEDURE rollback_235_drop_fk_ip_pools_nas()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA        = DATABASE()
      AND TABLE_NAME          = 'ip_pools'
      AND CONSTRAINT_NAME     = 'fk_ip_pools_nas'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE ip_pools DROP FOREIGN KEY fk_ip_pools_nas;
  END IF;
END //
DELIMITER ;
CALL rollback_235_drop_fk_ip_pools_nas();
DROP PROCEDURE IF EXISTS rollback_235_drop_fk_ip_pools_nas;

-- ---------------------------------------------------------------------------
-- Drop index: idx_ip_pools_nas_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_235_drop_idx_ip_pools_nas_id;
DELIMITER //
CREATE PROCEDURE rollback_235_drop_idx_ip_pools_nas_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND INDEX_NAME   = 'idx_ip_pools_nas_id'
  ) THEN
    ALTER TABLE ip_pools DROP INDEX idx_ip_pools_nas_id;
  END IF;
END //
DELIMITER ;
CALL rollback_235_drop_idx_ip_pools_nas_id();
DROP PROCEDURE IF EXISTS rollback_235_drop_idx_ip_pools_nas_id;

-- ---------------------------------------------------------------------------
-- Drop columns: last_alerted_threshold, excluded_ranges, default_prefix_len,
--               service_type, nas_id
-- (Reversed order of addition for clean dependency resolution.)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_235_drop_ip_pools_cols;
DELIMITER //
CREATE PROCEDURE rollback_235_drop_ip_pools_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'last_alerted_threshold'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN last_alerted_threshold;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'excluded_ranges'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN excluded_ranges;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'default_prefix_len'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN default_prefix_len;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'service_type'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN service_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'nas_id'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN nas_id;
  END IF;
END //
DELIMITER ;
CALL rollback_235_drop_ip_pools_cols();
DROP PROCEDURE IF EXISTS rollback_235_drop_ip_pools_cols;
