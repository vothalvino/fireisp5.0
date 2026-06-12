-- =============================================================================
-- Migration 308: Reporting & Analytics core tables — §15
-- =============================================================================
-- New tables:
--   report_definitions  — registry of built-in and custom report templates
--   scheduled_reports   — per-org schedule: format, recipients, cron, next_run
--   generated_reports   — history of generated report files
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: report_definitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_definitions (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'NULL = system-wide built-in definition',
    name            VARCHAR(100)    NOT NULL,
    category        ENUM('financial','operational','network','compliance','custom')
                        NOT NULL DEFAULT 'custom',
    description     TEXT            NULL,
    sql_template    TEXT            NULL     COMMENT 'Parameterized SQL template (system reports only)',
    parameters      JSON            NULL     COMMENT 'Parameter schema: [{name, type, label, required}]',
    is_system       TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 = built-in, 0 = user-created',
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_report_def_org (organization_id),
    KEY idx_report_def_category (category),
    KEY idx_report_def_system (is_system),
    KEY idx_report_def_deleted_at (deleted_at),
    CONSTRAINT fk_report_def_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_report_def_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Registry of built-in and user-created report definitions (§15)';

-- ---------------------------------------------------------------------------
-- Table: scheduled_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_reports (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    report_def_id       BIGINT UNSIGNED NULL     COMMENT 'FK to report_definitions; NULL for ad-hoc',
    report_def_name     VARCHAR(100)    NOT NULL  COMMENT 'Denormalized: report identifier slug',
    format              ENUM('csv','xlsx','pdf')  NOT NULL DEFAULT 'csv',
    parameters          JSON            NULL      COMMENT 'Runtime parameter values for the report',
    recipients          JSON            NULL      COMMENT 'Array of email addresses',
    cron_expression     VARCHAR(100)    NOT NULL  DEFAULT '0 8 * * 1' COMMENT 'Cron: Monday 08:00',
    is_enabled          TINYINT(1)      NOT NULL DEFAULT 1,
    next_run_at         DATETIME        NULL,
    last_run_at         DATETIME        NULL,
    last_status         ENUM('pending','completed','failed') NULL,
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_sched_reports_org (organization_id),
    KEY idx_sched_reports_enabled (is_enabled),
    KEY idx_sched_reports_next_run (next_run_at),
    KEY idx_sched_reports_deleted_at (deleted_at),
    CONSTRAINT fk_sched_reports_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_sched_reports_def FOREIGN KEY (report_def_id)
        REFERENCES report_definitions (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sched_reports_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-org scheduled report configurations (§15.5)';

-- ---------------------------------------------------------------------------
-- Table: generated_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_reports (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    scheduled_report_id BIGINT UNSIGNED NULL     COMMENT 'NULL for on-demand reports',
    report_def_name     VARCHAR(100)    NOT NULL  COMMENT 'Report identifier slug',
    format              ENUM('csv','xlsx','pdf')  NOT NULL DEFAULT 'csv',
    file_path           VARCHAR(512)    NULL      COMMENT 'Path to generated file on disk',
    file_size           BIGINT UNSIGNED NULL      COMMENT 'File size in bytes',
    status              ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
    error_message       TEXT            NULL,
    generated_by        BIGINT UNSIGNED NULL      COMMENT 'User who triggered on-demand generation',
    generated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_gen_reports_org (organization_id),
    KEY idx_gen_reports_sched (scheduled_report_id),
    KEY idx_gen_reports_status (status),
    KEY idx_gen_reports_generated_at (generated_at),
    CONSTRAINT fk_gen_reports_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_gen_reports_sched FOREIGN KEY (scheduled_report_id)
        REFERENCES scheduled_reports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_gen_reports_generated_by FOREIGN KEY (generated_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='History of generated report files (§15.5)';
