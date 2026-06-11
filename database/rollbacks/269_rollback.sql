-- =============================================================================
-- Rollback 269: Remove FTTH scheduled task seeds
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name IN (
    'ftth_olt_chassis_poll',
    'ftth_olt_port_metrics_poll',
    'ftth_onu_discovery',
    'ftth_onu_optical_poll',
    'ftth_onu_firmware_job_processor',
    'ftth_onu_optical_metrics_cleanup'
)
AND organization_id IS NULL;
