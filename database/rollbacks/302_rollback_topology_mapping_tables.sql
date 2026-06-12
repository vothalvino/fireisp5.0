-- Rollback 302
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS device_dependency_edges;
DROP TABLE IF EXISTS fiber_route_segments;
DROP TABLE IF EXISTS map_infrastructure_points;
DROP TABLE IF EXISTS map_geofences;
SET FOREIGN_KEY_CHECKS = 1;

DROP PROCEDURE IF EXISTS rollback_302;
DELIMITER ;;
CREATE PROCEDURE rollback_302()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'parent_device_id'
  ) THEN
    ALTER TABLE devices DROP COLUMN parent_device_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'longitude'
  ) THEN
    ALTER TABLE devices DROP COLUMN longitude;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'latitude'
  ) THEN
    ALTER TABLE devices DROP COLUMN latitude;
  END IF;
END ;;
DELIMITER ;
CALL rollback_302();
DROP PROCEDURE IF EXISTS rollback_302;
