-- Rollback 208: Remove payment reminder tables and scheduled task

DROP TABLE IF EXISTS payment_reminder_logs;
DROP TABLE IF EXISTS payment_reminder_settings;

DELETE FROM scheduled_tasks WHERE task_name = 'send_payment_reminders';
