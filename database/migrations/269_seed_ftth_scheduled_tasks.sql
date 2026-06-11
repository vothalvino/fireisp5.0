-- =============================================================================
-- Migration 269: Seed scheduled tasks for FTTH OLT & ONU management (§7.1/§7.2)
-- =============================================================================
-- Seeds global (organization_id IS NULL) scheduled tasks for:
--   1. OLT chassis metrics polling  (snmp_poll, every 5 min)
--   2. OLT PON port metrics polling (snmp_poll, every 5 min)
--   3. ONU discovery scan           (maintenance, every 15 min)
--   4. ONU optical diagnostics poll (snmp_poll, every 10 min)
--   5. ONU firmware job processor   (maintenance, every 1 min)
--   6. ONU optical metrics cleanup  (cleanup, nightly)
--
-- All inserts are idempotent: INSERT ... SELECT ... WHERE NOT EXISTS
-- (matching on task_name + organization_id IS NULL).
-- task_type values all exist in the migration-047 enum.
-- =============================================================================

-- 1. OLT chassis monitoring (CPU / memory / temperature / PSU / fan via SNMP)
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'ftth_olt_chassis_poll',
    'snmp_poll',
    'services/ftth/oltChassisPollHandler',
    'Poll OLT chassis metrics (CPU, memory, temperature, PSU, fan) via SNMP for all active OLT devices',
    '*/5 * * * *',
    'normal',
    3,
    120,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'ftth_olt_chassis_poll'
      AND organization_id IS NULL
);

-- 2. OLT PON port metrics (Tx/Rx optical power, ONU count, bandwidth)
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'ftth_olt_port_metrics_poll',
    'snmp_poll',
    'services/ftth/oltPortMetricsPollHandler',
    'Poll OLT PON port metrics (optical power, ONU count, bandwidth) via SNMP and update olt_ports records',
    '*/5 * * * *',
    'normal',
    3,
    180,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'ftth_olt_port_metrics_poll'
      AND organization_id IS NULL
);

-- 3. ONU auto-discovery (scan OLT for unconfigured/new ONUs)
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'ftth_onu_discovery',
    'maintenance',
    'services/ftth/onuDiscoveryHandler',
    'Scan OLT devices for newly connected ONUs, create onu_details records with state=unconfigured, and check against onu_whitelist',
    '*/15 * * * *',
    'normal',
    2,
    300,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'ftth_onu_discovery'
      AND organization_id IS NULL
);

-- 4. ONU optical diagnostics poll (Tx/Rx/temp/voltage/bias current)
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'ftth_onu_optical_poll',
    'snmp_poll',
    'services/ftth/onuOpticalPollHandler',
    'Poll per-ONU optical diagnostics (Tx power, Rx power, temperature, voltage, bias current) and insert rows into onu_optical_metrics',
    '*/10 * * * *',
    'normal',
    3,
    240,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'ftth_onu_optical_poll'
      AND organization_id IS NULL
);

-- 5. ONU firmware job processor (execute pending firmware/reboot jobs)
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'ftth_onu_firmware_job_processor',
    'maintenance',
    'services/ftth/onuFirmwareJobProcessor',
    'Pick up pending onu_firmware_jobs whose scheduled_at <= NOW() and execute via OLT CLI stub; update job status on completion',
    '* * * * *',
    'high',
    1,
    600,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'ftth_onu_firmware_job_processor'
      AND organization_id IS NULL
);

-- 6. ONU optical metrics retention cleanup (keep last 90 days)
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'ftth_onu_optical_metrics_cleanup',
    'cleanup',
    'services/ftth/onuOpticalMetricsCleanup',
    'Delete onu_optical_metrics rows older than 90 days in batches of 10000 to keep the table bounded',
    '0 3 * * *',
    'low',
    2,
    600,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'ftth_onu_optical_metrics_cleanup'
      AND organization_id IS NULL
);
