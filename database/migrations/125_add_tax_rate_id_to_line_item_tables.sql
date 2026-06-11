-- Migration: 125_add_tax_rate_id_to_line_item_tables
-- Description: Adds a per-line-item tax rate override column to the three
--              line-item tables (invoice_items, quote_items, credit_note_items).
--
--              Migration 056 added tax_rate_id to the parent document tables
--              (invoices, quotes, credit_notes) for a single document-level
--              rate.  This migration adds the same FK column at the line-item
--              level so that individual line items can carry their own rate —
--              required for mixed-rate invoices common in multi-tax-rate
--              jurisdictions (e.g. different rates for hardware vs. services).
--
--              NULL means "inherit the rate from the parent document".
--              ON DELETE SET NULL ensures that deleting a tax_rate row does
--              not cascade-delete line items.
--
--              All additions are guarded with INFORMATION_SCHEMA checks so the
--              migration is safely re-runnable after a partial failure.

SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------------------
-- invoice_items
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_125_invoice_items_tax_rate;
DELIMITER //
CREATE PROCEDURE migration_125_invoice_items_tax_rate()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoice_items'
      AND COLUMN_NAME  = 'tax_rate_id'
  ) THEN
    ALTER TABLE invoice_items
        ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
            COMMENT 'Per-line-item tax rate override; NULL = inherit from parent invoice'
            AFTER unit_price;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoice_items'
      AND INDEX_NAME   = 'idx_invoice_items_tax_rate_id'
  ) THEN
    ALTER TABLE invoice_items
        ADD KEY idx_invoice_items_tax_rate_id (tax_rate_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'invoice_items'
      AND CONSTRAINT_NAME       = 'fk_invoice_items_tax_rate'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE invoice_items
        ADD CONSTRAINT fk_invoice_items_tax_rate FOREIGN KEY (tax_rate_id)
            REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_125_invoice_items_tax_rate();
DROP PROCEDURE IF EXISTS migration_125_invoice_items_tax_rate;

-- -------------------------------------------------------------------------
-- quote_items
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_125_quote_items_tax_rate;
DELIMITER //
CREATE PROCEDURE migration_125_quote_items_tax_rate()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quote_items'
      AND COLUMN_NAME  = 'tax_rate_id'
  ) THEN
    ALTER TABLE quote_items
        ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
            COMMENT 'Per-line-item tax rate override; NULL = inherit from parent quote'
            AFTER unit_price;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quote_items'
      AND INDEX_NAME   = 'idx_quote_items_tax_rate_id'
  ) THEN
    ALTER TABLE quote_items
        ADD KEY idx_quote_items_tax_rate_id (tax_rate_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'quote_items'
      AND CONSTRAINT_NAME       = 'fk_quote_items_tax_rate'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE quote_items
        ADD CONSTRAINT fk_quote_items_tax_rate FOREIGN KEY (tax_rate_id)
            REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_125_quote_items_tax_rate();
DROP PROCEDURE IF EXISTS migration_125_quote_items_tax_rate;

-- -------------------------------------------------------------------------
-- credit_note_items
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_125_credit_note_items_tax_rate;
DELIMITER //
CREATE PROCEDURE migration_125_credit_note_items_tax_rate()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_note_items'
      AND COLUMN_NAME  = 'tax_rate_id'
  ) THEN
    ALTER TABLE credit_note_items
        ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
            COMMENT 'Per-line-item tax rate override; NULL = inherit from parent credit note'
            AFTER unit_price;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_note_items'
      AND INDEX_NAME   = 'idx_credit_note_items_tax_rate_id'
  ) THEN
    ALTER TABLE credit_note_items
        ADD KEY idx_credit_note_items_tax_rate_id (tax_rate_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'credit_note_items'
      AND CONSTRAINT_NAME       = 'fk_credit_note_items_tax_rate'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE credit_note_items
        ADD CONSTRAINT fk_credit_note_items_tax_rate FOREIGN KEY (tax_rate_id)
            REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_125_credit_note_items_tax_rate();
DROP PROCEDURE IF EXISTS migration_125_credit_note_items_tax_rate;

SET FOREIGN_KEY_CHECKS = 1;
