-- =============================================================================
-- FireISP 5.0 — Rollback 157: Remove IFT-format columns from
--                             ift_statistical_reports
-- =============================================================================
-- Reverses migration 157.  Drops the foreign key, the index, and the five
-- columns the migration added (concession_title_id,
-- subscribers_by_municipality, subscribers_by_customer_type,
-- subscribers_by_payment_modality, notes).
--
-- The FK is dropped before its supporting index and column.  Each step is
-- guarded on INFORMATION_SCHEMA so a partially applied migration still rolls
-- back cleanly (MySQL 8 has no DROP COLUMN / DROP INDEX IF EXISTS).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_157_align_ift_statistical_reports;
DELIMITER //
CREATE PROCEDURE rollback_157_align_ift_statistical_reports()
BEGIN
  -- 1. Foreign key first (it depends on the index/column)
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA    = DATABASE()
      AND TABLE_NAME      = 'ift_statistical_reports'
      AND CONSTRAINT_NAME = 'fk_ift_statistical_reports_concession_title'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE ift_statistical_reports
      DROP FOREIGN KEY fk_ift_statistical_reports_concession_title;
  END IF;

  -- 2. Index added by the migration
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND INDEX_NAME   = 'idx_ift_statistical_reports_concession_title_id'
  ) THEN
    ALTER TABLE ift_statistical_reports
      DROP INDEX idx_ift_statistical_reports_concession_title_id;
  END IF;

  -- 3. Columns added by the migration
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'concession_title_id'
  ) THEN
    ALTER TABLE ift_statistical_reports DROP COLUMN concession_title_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'subscribers_by_municipality'
  ) THEN
    ALTER TABLE ift_statistical_reports DROP COLUMN subscribers_by_municipality;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'subscribers_by_customer_type'
  ) THEN
    ALTER TABLE ift_statistical_reports DROP COLUMN subscribers_by_customer_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'subscribers_by_payment_modality'
  ) THEN
    ALTER TABLE ift_statistical_reports DROP COLUMN subscribers_by_payment_modality;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'notes'
  ) THEN
    ALTER TABLE ift_statistical_reports DROP COLUMN notes;
  END IF;
END //
DELIMITER ;
CALL rollback_157_align_ift_statistical_reports();
DROP PROCEDURE IF EXISTS rollback_157_align_ift_statistical_reports;
