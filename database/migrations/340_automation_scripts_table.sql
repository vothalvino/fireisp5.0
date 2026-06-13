-- =============================================================================
-- Migration 340 — §18.2 Scripting Engine: automation_scripts + script_executions
-- =============================================================================
-- SECURITY NOTE: Scripts are stored and NEVER executed directly via child_process.
-- The runner is STUBBED: execution records are created with status 'queued'.
-- A real sandboxed executor is explicitly out of scope.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: automation_scripts
-- Purpose: Script storage for the scripting engine (Bash / Python / PowerShell).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_scripts (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'NULL = community/shared script',
    name                VARCHAR(255)    NOT NULL,
    description         TEXT            NULL,
    language            ENUM('bash','python','powershell','javascript') NOT NULL DEFAULT 'bash',
    script_body         LONGTEXT        NOT NULL COMMENT 'Script source code — NEVER executed via child_process; stored only',
    version             SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    is_shared           TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 = community/library script visible to all orgs',
    tags                JSON            NULL     COMMENT 'Array of tag strings for categorization',
    scheduled_task_id   BIGINT UNSIGNED NULL     COMMENT 'Optional link to scheduled_tasks for recurring execution',
    api_endpoint        VARCHAR(500)    NULL     COMMENT 'External API endpoint this script calls (documentation only)',
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_automation_scripts_org (organization_id),
    KEY idx_automation_scripts_language (language),
    KEY idx_automation_scripts_shared (is_shared),
    KEY idx_automation_scripts_deleted_at (deleted_at),
    CONSTRAINT fk_automation_scripts_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_automation_scripts_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Script library for the scripting engine — stored only, NOT executed directly (§18.2)';

-- ---------------------------------------------------------------------------
-- Table: script_executions
-- Purpose: Execution log for automation_scripts.
--          Status is 'queued' — real dispatch requires a sandboxed executor (out of scope).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS script_executions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    script_id           BIGINT UNSIGNED NOT NULL,
    status              ENUM('queued','running','success','failure','cancelled') NOT NULL DEFAULT 'queued'
                            COMMENT 'queued = stubbed; a real sandboxed executor sets running/success/failure',
    triggered_by        BIGINT UNSIGNED NULL     COMMENT 'User who triggered this execution; NULL = scheduled',
    input_params        JSON            NULL     COMMENT 'Runtime parameters passed to the script',
    stdout              LONGTEXT        NULL     COMMENT 'Captured stdout (populated by real executor)',
    stderr              LONGTEXT        NULL     COMMENT 'Captured stderr (populated by real executor)',
    exit_code           SMALLINT        NULL     COMMENT 'Process exit code (populated by real executor)',
    duration_ms         INT UNSIGNED    NULL,
    error_message       TEXT            NULL,
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_script_executions_org (organization_id),
    KEY idx_script_executions_script (script_id),
    KEY idx_script_executions_status (status),
    KEY idx_script_executions_triggered_by (triggered_by),
    KEY idx_script_executions_created_at (created_at),
    CONSTRAINT fk_script_executions_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_script_executions_script FOREIGN KEY (script_id)
        REFERENCES automation_scripts (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Execution log for automation_scripts — STUBBED dispatcher (§18.2)';
