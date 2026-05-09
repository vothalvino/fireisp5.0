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

-- 1. Rename title → subject
ALTER TABLE tickets
  CHANGE COLUMN `title` `subject` VARCHAR(255) NOT NULL;

-- 2. Add the notes column (after description, where it belongs logically)
ALTER TABLE tickets
  ADD COLUMN `notes` TEXT NULL COMMENT 'Internal operator notes on this ticket'
  AFTER `description`;

-- 3. Expand the status ENUM to include 'waiting'
ALTER TABLE tickets
  MODIFY COLUMN `status`
    ENUM('open', 'in_progress', 'waiting', 'resolved', 'closed')
    NOT NULL DEFAULT 'open';
