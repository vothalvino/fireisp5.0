-- =============================================================================
-- Migration 143: Add version columns for optimistic locking
-- =============================================================================
-- Adds a `version` column to critical tables to enable optimistic concurrency
-- control. Updates must include `WHERE version = ?` and increment the version.
-- Column additions are guarded with INFORMATION_SCHEMA checks so the
-- migration is safely re-runnable after a partial failure.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_143_add_version_column;
DELIMITER //
CREATE PROCEDURE migration_143_add_version_column(IN p_table VARCHAR(64))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = p_table
      AND COLUMN_NAME  = 'version'
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL migration_143_add_version_column('invoices');
CALL migration_143_add_version_column('contracts');
CALL migration_143_add_version_column('payments');
CALL migration_143_add_version_column('clients');

DROP PROCEDURE IF EXISTS migration_143_add_version_column;
