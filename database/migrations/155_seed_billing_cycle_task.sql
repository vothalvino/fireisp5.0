-- Migration: 155_seed_billing_cycle_task
-- Description: Seeds the billing_cycle scheduled task that orchestrates the
--              full automated billing engine:
--
--                1. Auto-generate invoices for contracts due today
--                2. Email each client their new invoice
--                3. Send suspension warning emails for overdue clients
--                   approaching the rule threshold
--                4. Suspend contracts that exceed the configured days_past_due
--                   threshold and email the client confirmation
--
--              Scheduled at 02:00 daily — after midnight UTC to ensure all
--              time-zone billing days are settled, and before business hours.
--
--              Uses INSERT IGNORE for idempotency — the scheduled_tasks table
--              has a UNIQUE KEY on (organization_id, task_name).

INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'billing_cycle',
     'generate_invoice',
     'Full automated billing cycle: generate invoices → email clients → send suspension warnings → suspend overdue contracts.',
     '0 2 * * *',
     'high',
     3,
     600,
     TRUE);
