-- =============================================================================
-- Migration 277: CPE Diagnostics and Session Logs (§8.3)
-- =============================================================================
-- New tables:
--   cpe_diagnostics   — stored results from TR-069 diagnostics runs
--   cpe_session_logs  — CWMP protocol error/event log per CPE session
-- cpe_tasks.task_type ENUM extended with diagnostic task types via guarded procedure.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: cpe_diagnostics
-- Stores the result snapshot of each diagnostic run dispatched via cpe_tasks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpe_diagnostics (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_device_id       BIGINT UNSIGNED NOT NULL,
    cpe_task_id         BIGINT UNSIGNED NULL COMMENT 'FK to the cpe_tasks row that triggered this diagnostic',
    diag_type           ENUM(
                            'ping',
                            'traceroute',
                            'wifi_snapshot',
                            'ethernet_status',
                            'wan_diagnostics'
                        ) NOT NULL,
    status              ENUM('pending','running','complete','error') NOT NULL DEFAULT 'pending',
    target_host         VARCHAR(253)    NULL COMMENT 'IP/hostname for ping and traceroute',
    result              JSON            NULL COMMENT 'Structured results: latency_ms, hops[], signal_dbm, client_count, port_stats, wan_details, etc.',
    error_message       TEXT            NULL,
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_cpe_diag_org (organization_id),
    KEY idx_cpe_diag_device (cpe_device_id),
    KEY idx_cpe_diag_task (cpe_task_id),
    KEY idx_cpe_diag_type_status (diag_type, status),
    KEY idx_cpe_diag_deleted_at (deleted_at),
    CONSTRAINT fk_cpe_diag_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_diag_device FOREIGN KEY (cpe_device_id) REFERENCES cpe_devices(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='TR-069 diagnostic run results per CPE device (§8.3)';

-- ---------------------------------------------------------------------------
-- Table: cpe_session_logs
-- Records CWMP session events and protocol errors for debugging/audit.
-- Volume: one row per session (Inform + task exchange). An org with 10 000 CPE
-- and 1 Inform/hour → ~240 000 rows/day. A cleanup scheduled_task trims rows
-- older than 90 days; no partition needed at this scale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpe_session_logs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_device_id       BIGINT UNSIGNED NULL COMMENT 'NULL when device cannot be identified',
    session_id          VARCHAR(64)     NULL COMMENT 'Optional client-supplied session identifier',
    event_type          ENUM(
                            'inform',
                            'task_dispatched',
                            'task_response',
                            'fault',
                            'auth_failure',
                            'parse_error',
                            'session_error'
                        ) NOT NULL DEFAULT 'session_error',
    message_type        VARCHAR(64)     NULL COMMENT 'CWMP SOAP message type (Inform, Fault, etc.)',
    task_type           VARCHAR(64)     NULL COMMENT 'cpe_tasks.task_type when event_type=task_dispatched/task_response',
    fault_code          VARCHAR(16)     NULL,
    fault_string        TEXT            NULL,
    remote_ip           VARCHAR(45)     NULL,
    raw_excerpt         TEXT            NULL COMMENT 'First 2000 chars of SOAP envelope for debugging',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cpe_sl_org (organization_id),
    KEY idx_cpe_sl_device (cpe_device_id),
    KEY idx_cpe_sl_event (event_type),
    KEY idx_cpe_sl_created_at (created_at),
    CONSTRAINT fk_cpe_sl_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CWMP session event and error log per CPE device (§8.3)';

-- ---------------------------------------------------------------------------
-- Extend cpe_tasks.task_type ENUM to include diagnostic task types.
-- Guarded: only run if the current ENUM definition is missing the new values.
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _mig277_extend_task_type_enum;

DELIMITER //
CREATE PROCEDURE _mig277_extend_task_type_enum()
BEGIN
  DECLARE col_type TEXT;
  SELECT COLUMN_TYPE INTO col_type
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'cpe_tasks'
    AND COLUMN_NAME = 'task_type';

  IF col_type NOT LIKE '%ping_diagnostic%' THEN
    ALTER TABLE cpe_tasks
      MODIFY COLUMN task_type ENUM(
        'get_parameter_values',
        'set_parameter_values',
        'get_parameter_names',
        'download',
        'reboot',
        'factory_reset',
        'add_object',
        'delete_object',
        'ping_diagnostic',
        'traceroute_diagnostic',
        'wifi_diagnostics',
        'wan_diagnostics'
      ) NOT NULL;
  END IF;
END
//
DELIMITER ;

CALL _mig277_extend_task_type_enum();
DROP PROCEDURE IF EXISTS _mig277_extend_task_type_enum;

-- ---------------------------------------------------------------------------
-- Seed permissions for §8.3
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('cpe_diagnostics.view',   'View CPE Diagnostics',    'network'),
    ('cpe_diagnostics.create', 'Run CPE Diagnostics',     'network'),
    ('cpe_diagnostics.delete', 'Delete CPE Diagnostics',  'network'),
    ('cpe_session_logs.view',  'View CPE Session Logs',   'network'),
    ('cpe_session_logs.delete','Delete CPE Session Logs', 'network');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'cpe_diagnostics.view', 'cpe_diagnostics.create', 'cpe_diagnostics.delete',
    'cpe_session_logs.view', 'cpe_session_logs.delete'
)
WHERE r.name = 'admin';

-- ---------------------------------------------------------------------------
-- Seed cleanup scheduled task for cpe_session_logs (90-day trim)
-- ---------------------------------------------------------------------------

INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'cpe_session_log_cleanup',
    'cleanup',
    'services/acs/sessionLogCleanup',
    'Delete cpe_session_logs rows older than 90 days to bound table growth',
    '0 3 * * *',
    'low',
    1,
    60,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'cpe_session_log_cleanup'
      AND organization_id IS NULL
);
