-- Migration: 047_create_scheduled_tasks_table
-- Description: App-level job queue / cron history for observability. Tracks
--              every scheduled task (billing auto-generation, RADIUS sync,
--              SNMP polls) with last-run, next-run, and status beyond the
--              MySQL Event Scheduler's own limited history.

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    task_name         VARCHAR(100)     NOT NULL,
    description       VARCHAR(255)     NULL,
    cron_expression   VARCHAR(50)      NULL     COMMENT 'Cron expression, e.g. ''0 * * * *'' for every hour',
    last_run_at       TIMESTAMP        NULL,
    next_run_at       TIMESTAMP        NULL,
    last_status       ENUM('success', 'failed', 'running', 'skipped') NULL,
    last_error        TEXT             NULL,
    last_duration_ms  INT UNSIGNED     NULL     COMMENT 'Duration of the last run in milliseconds',
    is_enabled        BOOLEAN          NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_scheduled_tasks_name (task_name),
    KEY idx_scheduled_tasks_enabled_next (is_enabled, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
