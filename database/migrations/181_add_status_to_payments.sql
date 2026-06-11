-- Migration: 181_add_status_to_payments
-- Description: Adds the missing 'status' column to the payments table.
--
-- Payment.fillable includes 'status', the API validation schema exposes it
-- (enum: pending/completed/failed/refunded/cancelled), and the frontend
-- RecordPaymentModal always submits status='completed'.  However, the
-- payments table was never created with a status column, so every INSERT
-- via Payment.create() fails with "Unknown column 'status'" in strict mode.
--
-- Fix: add status ENUM with the same values as the validation schema,
-- defaulting to 'completed' (the most common value for manually-recorded
-- payments).  Existing rows are back-filled to 'completed' automatically
-- by the NOT NULL DEFAULT 'completed' clause.

-- Guarded with an INFORMATION_SCHEMA check so the migration is safely
-- re-runnable after a partial failure.
DROP PROCEDURE IF EXISTS migration_181_add_payments_status;
DELIMITER //
CREATE PROCEDURE migration_181_add_payments_status()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payments'
      AND COLUMN_NAME  = 'status'
  ) THEN
    ALTER TABLE payments
      ADD COLUMN status ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled')
        NOT NULL DEFAULT 'completed'
        COMMENT 'Payment lifecycle status'
        AFTER notes;
  END IF;
END //
DELIMITER ;
CALL migration_181_add_payments_status();
DROP PROCEDURE IF EXISTS migration_181_add_payments_status;
