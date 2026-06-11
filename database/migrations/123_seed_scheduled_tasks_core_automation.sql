-- Migration: 123_seed_scheduled_tasks_core_automation
-- Description: Seeds the five core automation jobs that drive the main
--              operational loops of FireISP:
--
--                auto_generate_invoices         — daily billing engine
--                auto_suspend_overdue           — overdue contract suspension
--                radius_sync                    — RADIUS account synchronization
--                populate_revenue_summary       — MRR / churn / ARPU aggregation
--                populate_network_health_snapshots — device uptime aggregation
--
--              All tasks are seeded with organization_id = NULL (global / all
--              tenants) and is_enabled = TRUE so they start running immediately
--              after installation.
--
--              Uses one INSERT ... SELECT ... WHERE NOT EXISTS per task for
--              idempotency.  The UNIQUE KEY on (organization_id, task_name)
--              never collides when organization_id is NULL (MySQL unique keys
--              treat NULLs as distinct), so INSERT IGNORE would insert
--              duplicate rows on every re-run.

-- 1. Auto-generate invoices
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'auto_generate_invoices',
    'generate_invoice',
    'App\\Tasks\\Billing\\AutoGenerateInvoicesTask',
    'Auto-generates invoices from billing_periods for contracts approaching their next billing date.',
    '0 1 * * *',
    'high',
    3,
    300,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'auto_generate_invoices' AND organization_id IS NULL
);

-- 2. Auto-suspend overdue contracts
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'auto_suspend_overdue',
    'auto_suspend',
    'App\\Tasks\\Billing\\AutoSuspendOverdueTask',
    'Suspends contracts that exceed the days-past-due threshold defined in suspension_rules.',
    '0 6 * * *',
    'high',
    3,
    300,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'auto_suspend_overdue' AND organization_id IS NULL
);

-- 3. RADIUS account synchronisation
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'radius_sync',
    'radius_sync',
    'App\\Tasks\\Network\\RadiusSyncTask',
    'Synchronises RADIUS subscriber accounts with the current state of active contracts.',
    '*/5 * * * *',
    'normal',
    3,
    120,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'radius_sync' AND organization_id IS NULL
);

-- 4. Revenue summary aggregation (MRR / churn / ARPU)
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'populate_revenue_summary',
    'usage_rollup',
    'App\\Tasks\\Reporting\\PopulateRevenueSummaryTask',
    'Recalculates MRR, churn rate, and ARPU and writes the results into the revenue_summary materialized table.',
    '0 2 1 * *',
    'normal',
    3,
    600,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'populate_revenue_summary' AND organization_id IS NULL
);

-- 5. Network health snapshot aggregation
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'populate_network_health_snapshots',
    'other',
    'App\\Tasks\\Network\\PopulateNetworkHealthSnapshotsTask',
    'Aggregates daily device uptime, latency, and link utilization into the network_health_snapshots table.',
    '0 4 * * *',
    'normal',
    3,
    600,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'populate_network_health_snapshots' AND organization_id IS NULL
);
