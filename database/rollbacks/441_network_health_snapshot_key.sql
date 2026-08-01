-- Rollback 441 — drop the upsert key and its generated column.
--
-- The index goes first: it is built on subject_key, so dropping the column with
-- the index still on it fails. Rows written by the aggregation are LEFT ALONE —
-- they are real data, and deleting them would turn a schema rollback into data
-- loss.
DROP PROCEDURE IF EXISTS rollback_441_network_health_snapshot_key;
DELIMITER //
CREATE PROCEDURE rollback_441_network_health_snapshot_key()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_health_snapshots'
      AND INDEX_NAME = 'uq_nhs_subject_date'
  ) THEN
    ALTER TABLE network_health_snapshots DROP INDEX uq_nhs_subject_date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_health_snapshots'
      AND COLUMN_NAME = 'subject_key'
  ) THEN
    ALTER TABLE network_health_snapshots DROP COLUMN subject_key;
  END IF;
END //
DELIMITER ;

CALL rollback_441_network_health_snapshot_key();
DROP PROCEDURE IF EXISTS rollback_441_network_health_snapshot_key;
