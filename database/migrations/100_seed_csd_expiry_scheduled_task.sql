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
--              Uses INSERT IGNORE to remain idempotent on re-runs.
--              organization_id = NULL means this task applies to all MX tenants
--              (the handler queries all organizations with MX profiles).

INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, payload, priority, max_retries, timeout_seconds,
     is_enabled)
VALUES
    (NULL,
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
     TRUE);
