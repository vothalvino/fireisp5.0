-- Rollback 299
DELETE FROM scheduled_tasks WHERE task_name = 'sla_breach_check';
