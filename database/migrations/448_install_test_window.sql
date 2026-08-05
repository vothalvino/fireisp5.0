-- =============================================================================
-- Migration 448 — install test window
-- =============================================================================
-- Until now a freshly provisioned (pending) contract's RADIUS account was
-- created status='active' and findSubscriber checks ONLY radius.status — so
-- the line came up at provisioning time and stayed up, unbilled, until formal
-- activation. Product decision (2026-08-05, both MX and global orgs): new
-- provisions start INACTIVE; the technician opens a bounded TEST WINDOW on
-- site (full internet, speed test included), the window closes by hand or by
-- sweep, and formal activation is what turns the line on permanently.
--
--   * contracts.test_window_expires_at — the bound. Set when the technician
--     starts the window (NOW() + install_test_window_minutes org setting,
--     default 60); cleared on activation and on window end. The sweep only
--     ever touches PENDING contracts whose bound has passed — activated
--     contracts and pre-448 grandfathered pending lines are never disabled
--     by it (existing pending contracts keep their active accounts; only
--     provisioning DEFAULTS change, so no surprise outages on live installs).
--
-- Seeds the test_window_expiry sweep task (every 5 minutes; the case is added
-- to src/services/taskRunner.js in the same PR — a seeded task with no case
-- never runs, silently).
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_448_test_window;
DELIMITER //
CREATE PROCEDURE migration_448_test_window()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'test_window_expires_at'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN test_window_expires_at DATETIME NULL
          COMMENT 'Technician test window bound: while set on a PENDING contract its RADIUS account is temporarily active; cleared on activation/window end; swept by test_window_expiry (migration 448)',
      ADD KEY idx_contracts_test_window (test_window_expires_at);
  END IF;
END //
DELIMITER ;

CALL migration_448_test_window();
DROP PROCEDURE IF EXISTS migration_448_test_window;

INSERT INTO scheduled_tasks
  (organization_id, task_name, task_type, description, cron_expression, priority, is_enabled)
SELECT NULL, 'test_window_expiry', 'maintenance',
       'Close expired install test windows: disable the RADIUS account and disconnect the session of pending contracts whose test bound has passed',
       '*/5 * * * *', 'normal', TRUE
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'test_window_expiry'
);
