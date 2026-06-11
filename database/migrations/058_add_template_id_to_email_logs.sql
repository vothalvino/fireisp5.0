-- Migration: 058_add_template_id_to_email_logs
-- Description: Links email_logs to the new message_templates table so every
--              sent message records which template was used to render it.
--              The existing VARCHAR template column is kept for backward
--              compatibility and free-text template names.
--
--              Column / key / FK additions use stored-procedure IF NOT EXISTS
--              guards so the file is safe to re-run after a mid-file failure.

-- ---------------------------------------------------------------------------
-- email_logs: template_id column + key + FK
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_058_add_email_logs_template_id;
DELIMITER //
CREATE PROCEDURE migration_058_add_email_logs_template_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'email_logs'
      AND COLUMN_NAME  = 'template_id'
  ) THEN
    ALTER TABLE email_logs
        ADD COLUMN template_id BIGINT UNSIGNED NULL COMMENT 'Template used to render this message; NULL = ad-hoc / legacy'
            AFTER template;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'email_logs'
      AND INDEX_NAME   = 'idx_email_logs_template_id'
  ) THEN
    ALTER TABLE email_logs
        ADD KEY idx_email_logs_template_id (template_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'email_logs'
      AND CONSTRAINT_NAME         = 'fk_email_logs_template'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE email_logs
        ADD CONSTRAINT fk_email_logs_template FOREIGN KEY (template_id)
            REFERENCES message_templates (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_058_add_email_logs_template_id();
DROP PROCEDURE IF EXISTS migration_058_add_email_logs_template_id;
