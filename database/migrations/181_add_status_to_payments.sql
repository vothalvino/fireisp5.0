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

ALTER TABLE payments
  ADD COLUMN status ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled')
    NOT NULL DEFAULT 'completed'
    COMMENT 'Payment lifecycle status'
    AFTER notes;
