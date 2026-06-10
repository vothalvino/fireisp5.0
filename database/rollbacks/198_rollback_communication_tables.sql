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

ALTER TABLE email_logs
    DROP COLUMN IF EXISTS campaign_message_id,
    DROP COLUMN IF EXISTS opened_at;

ALTER TABLE sms_logs
    DROP COLUMN IF EXISTS campaign_message_id;
