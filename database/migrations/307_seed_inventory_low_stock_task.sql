-- =============================================================================
-- Migration 307: Seed inventory_low_stock_check scheduled task — §14.1
-- =============================================================================

INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, is_enabled)
SELECT NULL, 'inventory_low_stock_check', 'notification',
    'Check inventory items below reorder level and send low-stock alerts',
    '0 * * * *', 'normal', TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks WHERE task_name = 'inventory_low_stock_check'
);
