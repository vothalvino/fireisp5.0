-- =============================================================================
-- Migration 254: Scheduled tasks for §6.1 SNMP Discovery
-- =============================================================================
-- Implements isp-platform-features.md §6.1 "SNMP Discovery":
--   Seeds two scheduled tasks:
--     snmp_discovery_poll  — recurring SNMP metrics polling (every 5 min)
--     snmp_trap_receiver   — one-shot UDP listener process start
--
-- Uses INSERT ... SELECT ... FROM DUAL WHERE NOT EXISTS for idempotency.
-- The UNIQUE KEY uq_scheduled_tasks_org_name (organization_id, task_name)
-- treats NULL organization_id values as distinct, so INSERT IGNORE would
-- duplicate global rows on re-run. The WHERE NOT EXISTS guard is required.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Task: snmp_discovery_poll
-- Polls SNMP metrics for all enabled devices every 5 minutes.
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'snmp_discovery_poll',
    'snmp_poll',
    'snmpPoller.poll',
    'SNMP metrics polling for all enabled devices',
    '*/5 * * * *',
    1,
    'normal'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'snmp_discovery_poll' AND organization_id IS NULL
);

-- ---------------------------------------------------------------------------
-- Task: snmp_trap_receiver
-- One-shot task to start the SNMP trap receiver UDP listener.
-- cron_expression is NULL = one-shot (not recurring).
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'snmp_trap_receiver',
    'snmp_poll',
    'snmpTrapReceiver.start',
    'SNMP trap receiver UDP listener',
    NULL,
    1,
    'high'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'snmp_trap_receiver' AND organization_id IS NULL
);
