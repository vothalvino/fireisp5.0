-- =============================================================================
-- Rollback 225: Remove plan/radius columns added for RADIUS authorization gaps
-- =============================================================================

DELETE FROM scheduled_tasks WHERE task_name = 'kick_duplicate_sessions';

-- Remove radius columns
DROP PROCEDURE IF EXISTS rollback_225_drop_radius_cols;
DELIMITER //
CREATE PROCEDURE rollback_225_drop_radius_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius' AND COLUMN_NAME = 'inner_vlan_id'
  ) THEN
    ALTER TABLE radius DROP COLUMN inner_vlan_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius' AND COLUMN_NAME = 'vlan_id'
  ) THEN
    ALTER TABLE radius DROP COLUMN vlan_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius' AND COLUMN_NAME = 'simultaneous_use'
  ) THEN
    ALTER TABLE radius DROP COLUMN simultaneous_use;
  END IF;
END //
DELIMITER ;
CALL rollback_225_drop_radius_cols();
DROP PROCEDURE IF EXISTS rollback_225_drop_radius_cols;

-- Remove plan columns
DROP PROCEDURE IF EXISTS rollback_225_drop_plan_cols;
DELIMITER //
CREATE PROCEDURE rollback_225_drop_plan_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'simultaneous_use'
  ) THEN
    ALTER TABLE plans DROP COLUMN simultaneous_use;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'idle_timeout_seconds'
  ) THEN
    ALTER TABLE plans DROP COLUMN idle_timeout_seconds;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'session_timeout_seconds'
  ) THEN
    ALTER TABLE plans DROP COLUMN session_timeout_seconds;
  END IF;
END //
DELIMITER ;
CALL rollback_225_drop_plan_cols();
DROP PROCEDURE IF EXISTS rollback_225_drop_plan_cols;
