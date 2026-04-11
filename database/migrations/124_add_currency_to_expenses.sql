-- Migration: 124_add_currency_to_expenses
-- Description: Adds the currency CHAR(3) column to the expenses table for
--              multi-currency expense tracking.
--
--              NOTE: Migration 051_add_currency_to_financial_tables.sql already
--              applies this exact ALTER TABLE to expenses.  This migration file
--              is retained for sequential numbering consistency and performs a
--              safe no-op check so it can be run on any installation without
--              error regardless of whether 051 has been applied.
--
--              On MySQL 8.0+ the procedure below uses INFORMATION_SCHEMA to
--              detect whether the column exists before attempting the ALTER,
--              avoiding the "Duplicate column name" error that would occur if
--              migration 051 had already run.

DROP PROCEDURE IF EXISTS _migration_124_add_currency_to_expenses;

DELIMITER $$

CREATE PROCEDURE _migration_124_add_currency_to_expenses()
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'expenses'
          AND  COLUMN_NAME  = 'currency'
    ) THEN
        ALTER TABLE expenses
            ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD'
            COMMENT 'ISO 4217 currency code'
            AFTER amount;

        CREATE INDEX idx_expenses_currency ON expenses (currency);
    END IF;
END$$

DELIMITER ;

CALL _migration_124_add_currency_to_expenses();

DROP PROCEDURE IF EXISTS _migration_124_add_currency_to_expenses;
