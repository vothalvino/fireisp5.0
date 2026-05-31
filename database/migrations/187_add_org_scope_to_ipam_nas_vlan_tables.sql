-- Migration: 187_add_org_scope_to_ipam_nas_vlan_tables
-- Description: Adds the organization_id tenant-scoping column expected by the
--              nas, ip_pools, ip_assignments, and vlans models (all declare
--              hasOrgScope = true but the column was missing from the DB).

SET @db_name = DATABASE();

-- NAS ------------------------------------------------------------------------
SET @has_nas_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'nas'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_nas_org = 0,
  'ALTER TABLE nas ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE nas n
LEFT JOIN (
  SELECT MIN(id) AS organization_id
  FROM organizations
) o ON TRUE
SET n.organization_id = COALESCE(n.organization_id, o.organization_id)
WHERE n.organization_id IS NULL;

SET @has_nas_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'nas'
    AND INDEX_NAME = 'idx_nas_organization_id'
);
SET @sql = IF(
  @has_nas_org_idx = 0,
  'CREATE INDEX idx_nas_organization_id ON nas (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_nas_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'nas'
    AND CONSTRAINT_NAME = 'fk_nas_organization'
);
SET @sql = IF(
  @has_nas_org_fk = 0,
  'ALTER TABLE nas ADD CONSTRAINT fk_nas_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- IP pools -------------------------------------------------------------------
SET @has_ip_pools_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_ip_pools_org = 0,
  'ALTER TABLE ip_pools ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE ip_pools p
LEFT JOIN sites s ON s.id = p.site_id
LEFT JOIN (
  SELECT MIN(id) AS organization_id
  FROM organizations
) o ON TRUE
SET p.organization_id = COALESCE(p.organization_id, s.organization_id, o.organization_id)
WHERE p.organization_id IS NULL;

SET @has_ip_pools_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND INDEX_NAME = 'idx_ip_pools_organization_id'
);
SET @sql = IF(
  @has_ip_pools_org_idx = 0,
  'CREATE INDEX idx_ip_pools_organization_id ON ip_pools (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ip_pools_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND CONSTRAINT_NAME = 'fk_ip_pools_organization'
);
SET @sql = IF(
  @has_ip_pools_org_fk = 0,
  'ALTER TABLE ip_pools ADD CONSTRAINT fk_ip_pools_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- IP assignments -------------------------------------------------------------
SET @has_ip_assignments_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_assignments'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_ip_assignments_org = 0,
  'ALTER TABLE ip_assignments ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE ip_assignments a
LEFT JOIN ip_pools p ON p.id = a.pool_id
LEFT JOIN clients c ON c.id = a.client_id
LEFT JOIN contracts ct ON ct.id = a.contract_id
LEFT JOIN (
  SELECT MIN(id) AS organization_id
  FROM organizations
) o ON TRUE
SET a.organization_id = COALESCE(a.organization_id, p.organization_id, c.organization_id, ct.organization_id, o.organization_id)
WHERE a.organization_id IS NULL;

SET @has_ip_assignments_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_assignments'
    AND INDEX_NAME = 'idx_ip_assignments_organization_id'
);
SET @sql = IF(
  @has_ip_assignments_org_idx = 0,
  'CREATE INDEX idx_ip_assignments_organization_id ON ip_assignments (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ip_assignments_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_assignments'
    AND CONSTRAINT_NAME = 'fk_ip_assignments_organization'
);
SET @sql = IF(
  @has_ip_assignments_org_fk = 0,
  'ALTER TABLE ip_assignments ADD CONSTRAINT fk_ip_assignments_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- VLANs ----------------------------------------------------------------------
SET @has_vlans_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'vlans'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_vlans_org = 0,
  'ALTER TABLE vlans ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE vlans v
LEFT JOIN sites s ON s.id = v.site_id
LEFT JOIN (
  SELECT MIN(id) AS organization_id
  FROM organizations
) o ON TRUE
SET v.organization_id = COALESCE(v.organization_id, s.organization_id, o.organization_id)
WHERE v.organization_id IS NULL;

SET @has_vlans_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'vlans'
    AND INDEX_NAME = 'idx_vlans_organization_id'
);
SET @sql = IF(
  @has_vlans_org_idx = 0,
  'CREATE INDEX idx_vlans_organization_id ON vlans (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_vlans_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'vlans'
    AND CONSTRAINT_NAME = 'fk_vlans_organization'
);
SET @sql = IF(
  @has_vlans_org_fk = 0,
  'ALTER TABLE vlans ADD CONSTRAINT fk_vlans_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
