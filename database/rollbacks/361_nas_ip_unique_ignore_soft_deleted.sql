-- Rollback: 361_nas_ip_unique_ignore_soft_deleted
-- Restores the single-column UNIQUE key uq_nas_ip_address (ip_address) and drops
-- the generated column ip_address_active + its unique key.
--
-- NOTE: re-adding uq_nas_ip_address (ip_address) will FAIL if, since migration
-- 361, the table gained rows that share an ip_address across live + soft-deleted
-- rows (which 361 intentionally allows). Resolve any such duplicates before
-- rolling back.

DROP PROCEDURE IF EXISTS rollback_361_nas_ip_unique_ignore_soft_deleted;
DELIMITER //
CREATE PROCEDURE rollback_361_nas_ip_unique_ignore_soft_deleted()
BEGIN
  -- 1. Restore the old single-column UNIQUE key (if absent).
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'uq_nas_ip_address'
  ) THEN
    ALTER TABLE nas ADD UNIQUE KEY uq_nas_ip_address (ip_address);
  END IF;

  -- 2. Drop the soft-delete-aware UNIQUE key (must precede dropping its column).
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'uq_nas_ip_address_active'
  ) THEN
    ALTER TABLE nas DROP INDEX uq_nas_ip_address_active;
  END IF;

  -- 3. Drop the generated column.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'ip_address_active'
  ) THEN
    ALTER TABLE nas DROP COLUMN ip_address_active;
  END IF;
END //
DELIMITER ;
CALL rollback_361_nas_ip_unique_ignore_soft_deleted();
DROP PROCEDURE IF EXISTS rollback_361_nas_ip_unique_ignore_soft_deleted;
