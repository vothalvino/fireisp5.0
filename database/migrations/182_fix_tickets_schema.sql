-- Migration: 182_fix_tickets_schema
-- Description: Fixes the tickets table so it matches what the application code expects.
--
-- Root causes:
-- 1. Migration 010 created the column as `title VARCHAR(255) NOT NULL`, but
--    every layer of the application (Ticket.fillable, validation schema,
--    frontend) uses the field name `subject`.  MySQL rejects every INSERT
--    with "Unknown column 'subject'" and the New Ticket modal never closes.
-- 2. Ticket.fillable includes `notes` but no such column exists.
-- 3. The status ENUM ('open','in_progress','resolved','closed') is missing
--    `'waiting'`, which both the API validation schema and the frontend
--    STATUSES list expose as a valid value.
--
-- The rename and the column add are guarded with INFORMATION_SCHEMA checks so
-- the migration is safely re-runnable after a partial failure; the MODIFY
-- COLUMN is naturally re-runnable and stays bare.

SET @db_name = DATABASE();

-- 1. Rename title → subject (only when `title` still exists and `subject`
--    does not — i.e. the rename has not already happened).
SET @has_tickets_title = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'title'
);
SET @has_tickets_subject = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'subject'
);
SET @sql = IF(
  @has_tickets_title = 1 AND @has_tickets_subject = 0,
  'ALTER TABLE tickets CHANGE COLUMN `title` `subject` VARCHAR(255) NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Add the notes column (after description, where it belongs logically)
SET @has_tickets_notes = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'notes'
);
SET @sql = IF(
  @has_tickets_notes = 0,
  'ALTER TABLE tickets ADD COLUMN `notes` TEXT NULL COMMENT ''Internal operator notes on this ticket'' AFTER `description`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Expand the status ENUM to include 'waiting'
ALTER TABLE tickets
  MODIFY COLUMN `status`
    ENUM('open', 'in_progress', 'waiting', 'resolved', 'closed')
    NOT NULL DEFAULT 'open';
