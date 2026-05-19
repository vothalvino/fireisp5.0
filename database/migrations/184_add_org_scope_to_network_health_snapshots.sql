-- Migration: 184_add_org_scope_to_network_health_snapshots
-- Description: Adds tenant scoping expected by dashboard and network-health APIs.

SET @db_name = DATABASE();

SET @has_network_health_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'network_health_snapshots'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_network_health_org = 0,
  'ALTER TABLE network_health_snapshots ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE network_health_snapshots nh
LEFT JOIN devices d ON d.id = nh.device_id
LEFT JOIN network_links nl ON nl.id = nh.network_link_id
SET nh.organization_id = COALESCE(nh.organization_id, d.organization_id, nl.organization_id)
WHERE nh.organization_id IS NULL;

SET @has_network_health_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'network_health_snapshots'
    AND INDEX_NAME = 'idx_network_health_organization_id'
);
SET @sql = IF(
  @has_network_health_org_idx = 0,
  'CREATE INDEX idx_network_health_organization_id ON network_health_snapshots (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_network_health_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'network_health_snapshots'
    AND CONSTRAINT_NAME = 'fk_network_health_organization'
);
SET @sql = IF(
  @has_network_health_org_fk = 0,
  'ALTER TABLE network_health_snapshots ADD CONSTRAINT fk_network_health_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
