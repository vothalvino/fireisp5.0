-- Migration: 047_create_scheduled_tasks_table
-- Description: App-level task queue for recurring and one-shot jobs such as
--              auto-suspending overdue clients, generating invoices, RADIUS
--              sync, and SNMP polling.  Each row is a dispatchable task with
--              cron scheduling, distributed locking, retry logic, priority,
--              and a JSON payload — going beyond the MySQL Event Scheduler's
--              limited history.

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = global / single-tenant deployment',
    task_name         VARCHAR(100)     NOT NULL COMMENT 'Unique machine-readable identifier, e.g. ''auto_suspend_overdue''',
    task_type         ENUM('auto_suspend', 'generate_invoice', 'radius_sync',
                          'snmp_poll', 'usage_rollup', 'cleanup',
                          'notification', 'backup', 'other')
                                       NOT NULL DEFAULT 'other'
                                       COMMENT 'Category of the scheduled task',
    handler           VARCHAR(255)     NULL     COMMENT 'Fully-qualified class or function that executes this task',
    description       VARCHAR(255)     NULL,
    cron_expression   VARCHAR(50)      NULL     COMMENT 'Cron expression, e.g. ''0 2 * * *'' for daily at 02:00; NULL = one-shot task',
    payload           JSON             NULL     COMMENT 'Arbitrary parameters passed to the handler at runtime',
    priority          ENUM('low', 'normal', 'high', 'critical')
                                       NOT NULL DEFAULT 'normal'
                                       COMMENT 'Execution priority; higher-priority tasks are picked first',
    max_retries       TINYINT UNSIGNED NOT NULL DEFAULT 3
                                       COMMENT 'Maximum consecutive retry attempts on failure',
    retry_count       TINYINT UNSIGNED NOT NULL DEFAULT 0
                                       COMMENT 'Current consecutive failure count; reset to 0 on success',
    timeout_seconds   INT UNSIGNED     NOT NULL DEFAULT 300
                                       COMMENT 'Maximum allowed runtime in seconds; exceeded tasks are considered stuck',
    last_run_at       TIMESTAMP        NULL,
    next_run_at       TIMESTAMP        NULL,
    last_status       ENUM('success', 'failed', 'running', 'skipped', 'timed_out') NULL,
    last_error        TEXT             NULL,
    last_duration_ms  INT UNSIGNED     NULL     COMMENT 'Duration of the last run in milliseconds',
    locked_at         TIMESTAMP        NULL     COMMENT 'Set when a worker claims this task; NULL = available',
    locked_by         VARCHAR(255)     NULL     COMMENT 'Identifier of the worker/process that claimed this task',
    is_enabled        BOOLEAN          NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_scheduled_tasks_org_name (organization_id, task_name),
    KEY idx_scheduled_tasks_enabled_next (is_enabled, next_run_at),
    KEY idx_scheduled_tasks_task_type (task_type),
    KEY idx_scheduled_tasks_priority_next (priority, next_run_at)
        COMMENT 'Worker pick query: enabled + due + highest priority first',
    KEY idx_scheduled_tasks_locked (locked_at, timeout_seconds)
        COMMENT 'Identify stuck tasks: WHERE locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL timeout_seconds SECOND',
    CONSTRAINT fk_scheduled_tasks_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_scheduled_tasks_retry CHECK (retry_count <= max_retries)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
