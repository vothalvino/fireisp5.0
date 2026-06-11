-- Migration: 157_align_ift_statistical_reports_with_ift_format
-- Description: Aligns the ift_statistical_reports table with the IFT
--              "Formato Estadistico - Servicio Fijo de Internet" required
--              fields, per docs/ift-statistical-report-schema-review.md.
--              Adds the concession title FK, the per-municipality breakdown,
--              the customer-type and payment-modality breakdowns, and a
--              free-form notes column.
--              All additions are guarded with INFORMATION_SCHEMA checks so
--              the migration is safely re-runnable after a partial failure.

-- Disable FK checks: concession_titles created in earlier migration (075).
SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS migration_157_align_ift_statistical_reports;
DELIMITER //
CREATE PROCEDURE migration_157_align_ift_statistical_reports()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'concession_title_id'
  ) THEN
    ALTER TABLE ift_statistical_reports
        ADD COLUMN concession_title_id BIGINT UNSIGNED NULL
            COMMENT 'Concession/authorization title under which the service is provided (IFT F2)'
            AFTER organization_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'subscribers_by_municipality'
  ) THEN
    ALTER TABLE ift_statistical_reports
        ADD COLUMN subscribers_by_municipality JSON NULL
            COMMENT 'JSON object: INEGI municipality code => subscriber count (IFT F5 breakdown)'
            AFTER subscribers_by_state;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'subscribers_by_customer_type'
  ) THEN
    ALTER TABLE ift_statistical_reports
        ADD COLUMN subscribers_by_customer_type JSON NULL
            COMMENT 'JSON object: residential/business subscriber counts (IFT F11)'
            AFTER subscribers_by_technology;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'subscribers_by_payment_modality'
  ) THEN
    ALTER TABLE ift_statistical_reports
        ADD COLUMN subscribers_by_payment_modality JSON NULL
            COMMENT 'JSON object: pospago/prepago/empaquetado subscriber counts (IFT F12)'
            AFTER subscribers_by_customer_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND COLUMN_NAME  = 'notes'
  ) THEN
    ALTER TABLE ift_statistical_reports
        ADD COLUMN notes TEXT NULL
            COMMENT 'Free-form notes / filing comments for this snapshot'
            AFTER status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ift_statistical_reports'
      AND INDEX_NAME   = 'idx_ift_statistical_reports_concession_title_id'
  ) THEN
    ALTER TABLE ift_statistical_reports
        ADD KEY idx_ift_statistical_reports_concession_title_id (concession_title_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'ift_statistical_reports'
      AND CONSTRAINT_NAME       = 'fk_ift_statistical_reports_concession_title'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE ift_statistical_reports
        ADD CONSTRAINT fk_ift_statistical_reports_concession_title
            FOREIGN KEY (concession_title_id)
            REFERENCES concession_titles (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_157_align_ift_statistical_reports();
DROP PROCEDURE IF EXISTS migration_157_align_ift_statistical_reports;

SET FOREIGN_KEY_CHECKS = 1;
