-- Rollback 307: Remove inventory_low_stock_check scheduled task
DELETE FROM scheduled_tasks WHERE task_name = 'inventory_low_stock_check';
