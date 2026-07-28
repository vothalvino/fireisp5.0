-- =============================================================================
-- Migration 434 — remember whether the TLS expiry check is actually working
-- =============================================================================
-- tlsMonitorService.checkTlsExpiry returns { checked: false, error } when it
-- cannot reach the endpoint, and NOTHING escalated that. So an install where
-- the app can never reach its own public hostname — behind a load balancer,
-- split-horizon DNS, an APP_URL that differs from the certificate SAN, a WAF
-- blocking it — reported a clean run forever and never alerted. That is the
-- same silent-failure shape the monitor was built to eliminate, one level up.
--
-- WHY NOT THE EXISTING scheduled_tasks COUNTER: it has consecutive_failures,
-- but the task deliberately does NOT throw on an unreachable host ("an outage
-- is not a monitor failure, and a throwing task would mark the run failed on
-- every blip" — its own comment). That reasoning is sound and this migration
-- does not overturn it; the task keeps succeeding, and the staleness is
-- tracked here instead.
--
-- WHY NOT THE settings TABLE: Organization.getSettings renders every key as an
-- editable field in the org Settings tab, so machine-managed operational state
-- would appear as something an admin is invited to type into. Migration 431
-- deleted a key for exactly that confusion.
--
-- WHY A TIMESTAMP RATHER THAN A COUNT: "no successful check since X" survives a
-- change to the task schedule, which a run-count does not — 5 consecutive
-- failures means 5 hours or 5 days depending on cron, and the operator cares
-- about wall-clock staleness.
--
-- Single row, id pinned to 1. Guarded via INFORMATION_SCHEMA (idempotent).
-- =============================================================================

CREATE TABLE IF NOT EXISTS tls_monitor_state (
    id                   TINYINT UNSIGNED NOT NULL DEFAULT 1
                             COMMENT 'Always 1 — the certificate is install-wide, so this is a single row',
    hostname             VARCHAR(255)     NULL     COMMENT 'Host last checked, from APP_URL',
    last_success_at      TIMESTAMP        NULL     COMMENT 'Last time the certificate was actually READ',
    last_failure_at      TIMESTAMP        NULL     COMMENT 'Last time the check could not reach the endpoint',
    consecutive_failures INT UNSIGNED     NOT NULL DEFAULT 0
                             COMMENT 'Runs since the last successful read; 0 while healthy',
    last_error           TEXT             NULL     COMMENT 'Why the last attempt failed',
    updated_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tls_monitor_state (id) VALUES (1)
ON DUPLICATE KEY UPDATE id = id;
