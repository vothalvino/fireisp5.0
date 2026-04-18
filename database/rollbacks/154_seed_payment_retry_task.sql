-- Rollback: 154_seed_payment_retry_task
DELETE FROM scheduled_tasks WHERE task_name = 'retry_failed_charges';
