-- =============================================================================
-- Rollback 236: Remove PPPoE Management Phase A permissions and scheduled task
-- =============================================================================
-- Reverses migration 236. Removes role assignments first (child rows via
-- role_permissions), then removes the permission records themselves, then
-- removes the scheduled task.
-- =============================================================================

DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE name IN (
        'ip_pools.assign',
        'ip_pools.utilization',
        'ip_pools.binding_report',
        'connection_logs.summary',
        'radius.batch_disconnect'
    )
);

DELETE FROM permissions WHERE name IN (
    'ip_pools.assign',
    'ip_pools.utilization',
    'ip_pools.binding_report',
    'connection_logs.summary',
    'radius.batch_disconnect'
);

DELETE FROM scheduled_tasks WHERE task_name = 'check_pool_utilization';
