-- =============================================================================
-- Migration 201: plan_speed_windows table (time-based speed plans)
-- =============================================================================

CREATE TABLE IF NOT EXISTS plan_speed_windows (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    plan_id             BIGINT UNSIGNED NOT NULL,
    organization_id     BIGINT UNSIGNED NULL,
    label               VARCHAR(100) NOT NULL,
    day_mask            TINYINT UNSIGNED NOT NULL DEFAULT 127 COMMENT 'bitmask: bit0=Sun,...,bit6=Sat; 127=all days',
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,
    download_speed_mbps INT UNSIGNED NOT NULL,
    upload_speed_mbps   INT UNSIGNED NOT NULL,
    priority            TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT 'Lower number = higher priority when windows overlap',
    status              ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_plan_speed_windows_plan_id (plan_id),
    KEY idx_plan_speed_windows_organization_id (organization_id),
    KEY idx_plan_speed_windows_status (status),
    CONSTRAINT fk_plan_speed_windows_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotency note: INSERT ... SELECT ... WHERE NOT EXISTS — the UNIQUE KEY
-- on (organization_id, task_name) never collides when organization_id is
-- NULL, so INSERT IGNORE would duplicate the row on re-run.
INSERT INTO scheduled_tasks (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT NULL, 'apply_speed_windows', 'Apply active time-based speed windows via RADIUS CoA at window boundaries', '*/5 * * * *', TRUE, 'normal'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'apply_speed_windows' AND organization_id IS NULL
);
