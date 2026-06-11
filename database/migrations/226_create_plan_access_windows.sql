-- =============================================================================
-- Migration 226: plan_access_windows table (item 12 — time-based access restriction)
-- =============================================================================
-- Implements isp-platform-features.md §3.2 item 12.
-- Stores per-plan access schedules using the same day_mask + time-window pattern
-- as plan_speed_windows (migration 201).
--
-- The sync layer converts these windows into a FreeRADIUS Login-Time radcheck
-- attribute using the FreeRADIUS Login-Time string format:
--   Day codes: Mo Tu We Th Fr Sa Su (or Wk = Mon-Fri, Al = all days)
--   Format:    <day_code>HHMM-HHMM[,...]
--   Example:   Wk0800-1800,Sa0900-1300
-- =============================================================================

CREATE TABLE IF NOT EXISTS plan_access_windows (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    plan_id         BIGINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NULL,
    label           VARCHAR(100)    NOT NULL
                        COMMENT 'Human-readable label e.g. "Business hours"',
    day_mask        TINYINT UNSIGNED NOT NULL DEFAULT 127
                        COMMENT 'Bitmask: bit0=Sun, bit1=Mon, ..., bit6=Sat; 127=all days (mirrors plan_speed_windows)',
    start_time      TIME            NOT NULL
                        COMMENT 'Start of allowed access window (inclusive)',
    end_time        TIME            NOT NULL
                        COMMENT 'End of allowed access window (exclusive)',
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_plan_access_windows_plan_id (plan_id),
    KEY idx_plan_access_windows_organization_id (organization_id),
    KEY idx_plan_access_windows_status (status),
    CONSTRAINT fk_plan_access_windows_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
