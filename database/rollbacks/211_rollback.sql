-- Rollback 211: Remove payment plan tables and scheduled task

DELETE FROM scheduled_tasks WHERE task_name = 'check_installments_due';

DROP TABLE IF EXISTS payment_plan_installments;
DROP TABLE IF EXISTS payment_plans;
