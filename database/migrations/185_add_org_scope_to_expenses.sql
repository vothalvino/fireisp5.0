-- Migration: 185_add_org_scope_to_expenses
-- Description: Adds tenant scoping expected by expense reports and the Expense model.

SET @db_name = DATABASE();

SET @has_expenses_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_expenses_org = 0,
  'ALTER TABLE expenses ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE expenses e
LEFT JOIN users u ON u.id = e.user_id
LEFT JOIN (
  SELECT MIN(id) AS organization_id
  FROM organizations
) o ON TRUE
SET e.organization_id = COALESCE(e.organization_id, u.organization_id, o.organization_id)
WHERE e.organization_id IS NULL;

SET @has_expenses_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'expenses'
    AND INDEX_NAME = 'idx_expenses_organization_id'
);
SET @sql = IF(
  @has_expenses_org_idx = 0,
  'CREATE INDEX idx_expenses_organization_id ON expenses (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_expenses_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'expenses'
    AND CONSTRAINT_NAME = 'fk_expenses_organization'
);
SET @sql = IF(
  @has_expenses_org_fk = 0,
  'ALTER TABLE expenses ADD CONSTRAINT fk_expenses_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
