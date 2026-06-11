-- Rollback 206: Remove late fee tables and scheduled task

DROP TABLE IF EXISTS invoice_late_fees;
DROP TABLE IF EXISTS late_fee_rules;

DELETE FROM scheduled_tasks WHERE task_name = 'apply_late_fees';
