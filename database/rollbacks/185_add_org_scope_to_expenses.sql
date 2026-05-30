-- =============================================================================
-- FireISP 5.0 — Rollback 185: Remove org scope from expenses
-- =============================================================================
-- Reverses migration 185 by dropping the organization_id foreign key, index,
-- and column from the expenses table.  Uses guarded INFORMATION_SCHEMA checks
-- so the rollback is idempotent and safe to re-run.
-- =============================================================================

SET @db_name = DATABASE();

SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'expenses'
    AND CONSTRAINT_NAME = 'fk_expenses_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'expenses'
    AND INDEX_NAME = 'idx_expenses_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_expenses_organization_id ON expenses', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE expenses DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
