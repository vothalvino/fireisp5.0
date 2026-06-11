-- Migration: 056_add_tax_rate_id_to_financial_tables
-- Description: Links invoices, quotes, and credit notes to the new tax_rates
--              master table. The existing tax_rate DECIMAL column is kept as a
--              snapshot of the rate at document-creation time; tax_rate_id
--              records which named configuration was used.
--
--              Column / key / FK additions use stored-procedure IF NOT EXISTS
--              guards so the file is safe to re-run after a mid-file failure.

-- ---------------------------------------------------------------------------
-- invoices: tax_rate_id column + key + FK
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_056_add_invoices_tax_rate_id;
DELIMITER //
CREATE PROCEDURE migration_056_add_invoices_tax_rate_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND COLUMN_NAME  = 'tax_rate_id'
  ) THEN
    ALTER TABLE invoices
        ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND INDEX_NAME   = 'idx_invoices_tax_rate_id'
  ) THEN
    ALTER TABLE invoices
        ADD KEY idx_invoices_tax_rate_id (tax_rate_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'invoices'
      AND CONSTRAINT_NAME         = 'fk_invoices_tax_rate'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_tax_rate FOREIGN KEY (tax_rate_id)
            REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_056_add_invoices_tax_rate_id();
DROP PROCEDURE IF EXISTS migration_056_add_invoices_tax_rate_id;

-- ---------------------------------------------------------------------------
-- quotes: tax_rate_id column + key + FK
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_056_add_quotes_tax_rate_id;
DELIMITER //
CREATE PROCEDURE migration_056_add_quotes_tax_rate_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND COLUMN_NAME  = 'tax_rate_id'
  ) THEN
    ALTER TABLE quotes
        ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND INDEX_NAME   = 'idx_quotes_tax_rate_id'
  ) THEN
    ALTER TABLE quotes
        ADD KEY idx_quotes_tax_rate_id (tax_rate_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'quotes'
      AND CONSTRAINT_NAME         = 'fk_quotes_tax_rate'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE quotes
        ADD CONSTRAINT fk_quotes_tax_rate FOREIGN KEY (tax_rate_id)
            REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_056_add_quotes_tax_rate_id();
DROP PROCEDURE IF EXISTS migration_056_add_quotes_tax_rate_id;

-- ---------------------------------------------------------------------------
-- credit_notes: tax_rate_id column + key + FK
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_056_add_credit_notes_tax_rate_id;
DELIMITER //
CREATE PROCEDURE migration_056_add_credit_notes_tax_rate_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_notes'
      AND COLUMN_NAME  = 'tax_rate_id'
  ) THEN
    ALTER TABLE credit_notes
        ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_notes'
      AND INDEX_NAME   = 'idx_credit_notes_tax_rate_id'
  ) THEN
    ALTER TABLE credit_notes
        ADD KEY idx_credit_notes_tax_rate_id (tax_rate_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'credit_notes'
      AND CONSTRAINT_NAME         = 'fk_credit_notes_tax_rate'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE credit_notes
        ADD CONSTRAINT fk_credit_notes_tax_rate FOREIGN KEY (tax_rate_id)
            REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_056_add_credit_notes_tax_rate_id();
DROP PROCEDURE IF EXISTS migration_056_add_credit_notes_tax_rate_id;
