-- =============================================================================
-- FireISP 5.0 — Rollback 198: Drop Communication tables
-- =============================================================================
-- Reverses migration 198. Drop order respects FK dependencies:
--   campaign_messages references communication_campaigns (CASCADE), so
--   communication_campaigns must be dropped after campaign_messages.
--   client_dnd_preferences is independent and can be dropped in any order.
-- Also reverses the ALTER TABLE statements on email_logs and sms_logs and
-- removes the campaign_send scheduled task.
-- =============================================================================

DELETE FROM scheduled_tasks WHERE task_name = 'campaign_send';

DROP TABLE IF EXISTS campaign_messages;
DROP TABLE IF EXISTS communication_campaigns;
DROP TABLE IF EXISTS client_dnd_preferences;

-- MySQL does not support DROP COLUMN IF EXISTS — use a stored-procedure guard.
DROP PROCEDURE IF EXISTS rollback_198_alter_message_logs;
DELIMITER //
CREATE PROCEDURE rollback_198_alter_message_logs()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_logs' AND COLUMN_NAME = 'campaign_message_id'
  ) THEN
    ALTER TABLE email_logs DROP COLUMN campaign_message_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_logs' AND COLUMN_NAME = 'opened_at'
  ) THEN
    ALTER TABLE email_logs DROP COLUMN opened_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_logs' AND COLUMN_NAME = 'campaign_message_id'
  ) THEN
    ALTER TABLE sms_logs DROP COLUMN campaign_message_id;
  END IF;
END //
DELIMITER ;
CALL rollback_198_alter_message_logs();
DROP PROCEDURE IF EXISTS rollback_198_alter_message_logs;
