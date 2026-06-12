-- Rollback 292: Traffic Engineering tables
-- NOTE: ENUM revert on queue_tree_nodes is intentionally skipped — reverting
--       ENUM values is unsafe if any rows use the new values.
SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS dscp_marking_policies;
DROP TABLE IF EXISTS mpls_vlan_prioritization_rules;
DROP TABLE IF EXISTS interface_qos_policies;
-- vendor_platform column removal (guarded)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'queue_tree_nodes'
    AND COLUMN_NAME  = 'vendor_platform'
);
SET @sql = IF(@col_exists > 0,
  'ALTER TABLE queue_tree_nodes DROP COLUMN vendor_platform',
  'SELECT ''Column vendor_platform already removed'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET FOREIGN_KEY_CHECKS=1;
