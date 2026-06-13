-- Rollback 322: §16 Scheduled task seed
DELETE FROM scheduled_tasks WHERE task_name = 'data_retention_compliance_check';
