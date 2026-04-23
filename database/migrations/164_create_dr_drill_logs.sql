-- Migration: 164_create_dr_drill_logs
-- Description: Creates the dr_drill_logs table to record the outcome of each
--              automated quarterly DR-drill run, and seeds the
--              quarterly_dr_drill scheduled task that fires at 02:00 on the
--              first day of each quarter (1 Jan, 1 Apr, 1 Jul, 1 Oct).
--
--              The automated drill is NON-DESTRUCTIVE:
--                Phase 1 — take a gzipped mysqldump and verify size > 1 MB
--                Phase 4 — run referential-integrity and financial-consistency
--                           queries against the live database
--
--              Phases 2 (drop) and 3 (restore) remain manual per
--              docs/dr-drill.md.  The drill result and an overdue flag
--              are surfaced in the admin frontend on every login.

-- ---------------------------------------------------------------------------
-- Table: dr_drill_logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dr_drill_logs (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    run_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT 'When this drill run started',
    status              ENUM('pass', 'fail', 'error') NOT NULL
                            COMMENT 'pass = all checks OK; fail = one or more checks failed; error = drill aborted by exception',
    backup_file         VARCHAR(500)     NULL
                            COMMENT 'Relative path to the backup file created in this drill',
    backup_size_bytes   BIGINT UNSIGNED  NULL
                            COMMENT 'Compressed size of the backup file in bytes',
    checks              JSON             NULL
                            COMMENT 'JSON object containing each check name mapped to its result',
    error_message       TEXT             NULL
                            COMMENT 'Error details when status is fail or error',
    duration_ms         INT UNSIGNED     NULL
                            COMMENT 'Total drill wall-clock time in milliseconds',

    PRIMARY KEY (id),
    KEY idx_dr_drill_logs_run_at (run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log for automated quarterly DR-drill runs.';

-- ---------------------------------------------------------------------------
-- Seed: quarterly_dr_drill scheduled task
-- Cron  0 2 1 1,4,7,10 *  =  02:00 on 1 Jan, 1 Apr, 1 Jul, 1 Oct
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'quarterly_dr_drill',
     'maintenance',
     'Quarterly automated DR drill: take a backup, verify size, run Phase-4 referential-integrity and financial-consistency checks, record pass/fail in dr_drill_logs. Phases 2-3 (drop + restore) remain manual per docs/dr-drill.md.',
     '0 2 1 1,4,7,10 *',   -- 02:00 on 1 Jan / 1 Apr / 1 Jul / 1 Oct
     'normal',
     1,
     3600,
     TRUE);
