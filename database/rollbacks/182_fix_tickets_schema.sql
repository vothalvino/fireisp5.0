-- =============================================================================
-- FireISP 5.0 — Rollback 182: Revert tickets schema fixes
-- =============================================================================
-- Reverses migration 182 by restoring the status ENUM (removing 'waiting'),
-- dropping the notes column, and renaming subject back to title.
--
-- NOTE: restoring the narrower status ENUM will fail if any ticket still uses
-- the 'waiting' status; update those rows before rolling back.
-- =============================================================================

ALTER TABLE tickets
  MODIFY COLUMN `status`
    ENUM('open', 'in_progress', 'resolved', 'closed')
    NOT NULL DEFAULT 'open';

ALTER TABLE tickets
  DROP COLUMN `notes`;

ALTER TABLE tickets
  CHANGE COLUMN `subject` `title` VARCHAR(255) NOT NULL;
