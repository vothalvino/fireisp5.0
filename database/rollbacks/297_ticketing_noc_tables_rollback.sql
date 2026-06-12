-- Rollback 297
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS technician_gps_breadcrumbs;
DROP TABLE IF EXISTS work_order_materials;
DROP TABLE IF EXISTS work_orders;
DROP TABLE IF EXISTS ticket_ai_triage;
DROP TABLE IF EXISTS ticket_relations;
DROP TABLE IF EXISTS ticket_time_logs;
SET FOREIGN_KEY_CHECKS = 1;

DROP PROCEDURE IF EXISTS rollback_297;
DELIMITER ;;
CREATE PROCEDURE rollback_297()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME = 'source'
  ) THEN
    ALTER TABLE tickets DROP COLUMN source;
  END IF;
END ;;
DELIMITER ;
CALL rollback_297();
DROP PROCEDURE IF EXISTS rollback_297;
