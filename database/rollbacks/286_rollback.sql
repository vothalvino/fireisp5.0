-- =============================================================================
-- Rollback 286: QoS Speed Profiles — §10.1
-- =============================================================================
-- Drops only objects created by migration 286.
-- =============================================================================

-- Remove FK on plans before dropping quality_classes
DROP PROCEDURE IF EXISTS rollback_286_drop_fk_plans_priority_class;
DELIMITER //
CREATE PROCEDURE rollback_286_drop_fk_plans_priority_class()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'plans'
      AND CONSTRAINT_NAME       = 'fk_plans_priority_class'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE plans DROP FOREIGN KEY fk_plans_priority_class;
  END IF;
END //
DELIMITER ;
CALL rollback_286_drop_fk_plans_priority_class();
DROP PROCEDURE IF EXISTS rollback_286_drop_fk_plans_priority_class;

-- Drop columns from plans
DROP PROCEDURE IF EXISTS rollback_286_drop_plans_cols;
DELIMITER //
CREATE PROCEDURE rollback_286_drop_plans_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'priority_class_id'
  ) THEN
    ALTER TABLE plans DROP COLUMN priority_class_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'burst_time_seconds'
  ) THEN
    ALTER TABLE plans DROP COLUMN burst_time_seconds;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'burst_threshold_mbps'
  ) THEN
    ALTER TABLE plans DROP COLUMN burst_threshold_mbps;
  END IF;
END //
DELIMITER ;
CALL rollback_286_drop_plans_cols();
DROP PROCEDURE IF EXISTS rollback_286_drop_plans_cols;

DROP TABLE IF EXISTS queue_tree_nodes;
DROP TABLE IF EXISTS quality_classes;
