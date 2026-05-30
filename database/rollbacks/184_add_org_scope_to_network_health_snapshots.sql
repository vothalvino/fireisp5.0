-- =============================================================================
-- FireISP 5.0 — Rollback 184: Remove org scope from network_health_snapshots
-- =============================================================================
-- Reverses migration 184 by dropping the organization_id foreign key, index,
-- and column from network_health_snapshots.  Uses guarded INFORMATION_SCHEMA
-- checks so the rollback is idempotent and safe to re-run.
-- =============================================================================

SET @db_name = DATABASE();

SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'network_health_snapshots'
    AND CONSTRAINT_NAME = 'fk_network_health_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE network_health_snapshots DROP FOREIGN KEY fk_network_health_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'network_health_snapshots'
    AND INDEX_NAME = 'idx_network_health_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_network_health_organization_id ON network_health_snapshots', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'network_health_snapshots'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE network_health_snapshots DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
