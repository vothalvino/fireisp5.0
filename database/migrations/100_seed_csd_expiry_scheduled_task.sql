-- Migration: 100_seed_csd_expiry_scheduled_task
-- Description: Inserts a system-level (organization_id = NULL) scheduled task
--              for CSD (Certificado de Sello Digital) expiry monitoring.
--
--              The task runs daily and checks organization_mx_profiles.csd_valid_to
--              for certificates expiring within 30 days, generating a notification
--              for each affected organization.
--
--              If a CSD expires the ISP cannot stamp (timbrar) any new CFDIs until
--              a renewed CSD is uploaded, which blocks the entire e-invoicing
--              workflow.  Early warning is therefore critical for operational
--              continuity.
--
--              Uses INSERT ... SELECT ... WHERE NOT EXISTS for idempotency.
--              The UNIQUE KEY uq_scheduled_tasks_org_name (organization_id,
--              task_name) never collides when organization_id is NULL (MySQL
--              unique keys treat NULLs as distinct), so INSERT IGNORE would
--              insert a duplicate row on every re-run.
--              organization_id = NULL means this task applies to all MX tenants
--              (the handler queries all organizations with MX profiles).

INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, payload, priority, max_retries, timeout_seconds,
     is_enabled)
SELECT
    NULL,
    'csd_expiry_monitor',
    'notification',
    'App\\Tasks\\Mx\\CsdExpiryMonitorTask',
    'Checks organization_mx_profiles.csd_valid_to and sends an alert when a CSD is within 30 days of expiration.',
    '0 8 * * *',
    JSON_OBJECT(
        'warning_days',    30,
        'critical_days',   7,
        'notification_channels', JSON_ARRAY('email', 'in_app')
    ),
    'high',
    3,
    120,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'csd_expiry_monitor' AND organization_id IS NULL
);
