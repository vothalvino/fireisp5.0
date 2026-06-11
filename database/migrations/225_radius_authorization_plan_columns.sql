-- =============================================================================
-- Migration 225: RADIUS Authorization gaps — plan and radius account columns
-- =============================================================================
-- Implements isp-platform-features.md §3.2 items 10, 11:
--   • plans.session_timeout_seconds  (item 10 — Session-Timeout)
--   • plans.idle_timeout_seconds     (item 10 — Idle-Timeout)
--   • plans.simultaneous_use         (item 11 — per-plan sim-use limit)
--   • radius.simultaneous_use        (item 11 — per-account override)
--
-- All ALTER TABLE statements are wrapped in INFORMATION_SCHEMA stored-procedure
-- guards (canonical MySQL pattern from migration 200/216/223).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- plans: session_timeout_seconds
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_225_add_plan_session_timeout;
DELIMITER //
CREATE PROCEDURE migration_225_add_plan_session_timeout()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'session_timeout_seconds'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN session_timeout_seconds INT UNSIGNED NULL
        COMMENT 'FreeRADIUS Session-Timeout (seconds); NULL = no limit; synced to radgroupreply'
        AFTER trial_price;
  END IF;
END //
DELIMITER ;
CALL migration_225_add_plan_session_timeout();
DROP PROCEDURE IF EXISTS migration_225_add_plan_session_timeout;

-- ---------------------------------------------------------------------------
-- plans: idle_timeout_seconds
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_225_add_plan_idle_timeout;
DELIMITER //
CREATE PROCEDURE migration_225_add_plan_idle_timeout()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'idle_timeout_seconds'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN idle_timeout_seconds INT UNSIGNED NULL
        COMMENT 'FreeRADIUS Idle-Timeout (seconds); NULL = no limit; synced to radgroupreply'
        AFTER session_timeout_seconds;
  END IF;
END //
DELIMITER ;
CALL migration_225_add_plan_idle_timeout();
DROP PROCEDURE IF EXISTS migration_225_add_plan_idle_timeout;

-- ---------------------------------------------------------------------------
-- plans: simultaneous_use (plan-level default)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_225_add_plan_sim_use;
DELIMITER //
CREATE PROCEDURE migration_225_add_plan_sim_use()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'simultaneous_use'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN simultaneous_use INT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Default max concurrent sessions per subscriber for this plan (RADIUS Simultaneous-Use :=)'
        AFTER idle_timeout_seconds;
  END IF;
END //
DELIMITER ;
CALL migration_225_add_plan_sim_use();
DROP PROCEDURE IF EXISTS migration_225_add_plan_sim_use;

-- ---------------------------------------------------------------------------
-- radius: simultaneous_use (per-account override; NULL = use plan default)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_225_add_radius_sim_use;
DELIMITER //
CREATE PROCEDURE migration_225_add_radius_sim_use()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'simultaneous_use'
  ) THEN
    ALTER TABLE radius
      ADD COLUMN simultaneous_use INT UNSIGNED NULL
        COMMENT 'Per-account concurrent session limit override; NULL = inherit from plan'
        AFTER auth_method;
  END IF;
END //
DELIMITER ;
CALL migration_225_add_radius_sim_use();
DROP PROCEDURE IF EXISTS migration_225_add_radius_sim_use;

-- ---------------------------------------------------------------------------
-- radius: vlan_id (item 13 — VLAN assignment via RADIUS)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_225_add_radius_vlan_id;
DELIMITER //
CREATE PROCEDURE migration_225_add_radius_vlan_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'vlan_id'
  ) THEN
    ALTER TABLE radius
      ADD COLUMN vlan_id SMALLINT UNSIGNED NULL
        COMMENT 'IEEE 802.1Q VLAN ID (1-4094) for RADIUS tunnel assignment; NULL = no VLAN'
        AFTER simultaneous_use;
  END IF;
END //
DELIMITER ;
CALL migration_225_add_radius_vlan_id();
DROP PROCEDURE IF EXISTS migration_225_add_radius_vlan_id;

-- ---------------------------------------------------------------------------
-- radius: inner_vlan_id (item 13 — QinQ inner tag)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_225_add_radius_inner_vlan_id;
DELIMITER //
CREATE PROCEDURE migration_225_add_radius_inner_vlan_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'inner_vlan_id'
  ) THEN
    ALTER TABLE radius
      ADD COLUMN inner_vlan_id SMALLINT UNSIGNED NULL
        COMMENT 'QinQ inner VLAN ID (1-4094); NULL = single-tag; outer tag is vlan_id'
        AFTER vlan_id;
  END IF;
END //
DELIMITER ;
CALL migration_225_add_radius_inner_vlan_id();
DROP PROCEDURE IF EXISTS migration_225_add_radius_inner_vlan_id;

-- ---------------------------------------------------------------------------
-- Seed: kick_duplicate_sessions scheduled task (item 11)
--
-- Idempotency note: INSERT ... SELECT ... WHERE NOT EXISTS — the UNIQUE KEY
-- on (organization_id, task_name) never collides when organization_id is
-- NULL, so INSERT IGNORE would duplicate the row on re-run.
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'kick_duplicate_sessions',
    'Find subscribers with more active sessions than their simultaneous_use limit allows and disconnect the oldest excess sessions via RADIUS Disconnect-Request',
    '*/5 * * * *',
    TRUE,
    'normal'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'kick_duplicate_sessions' AND organization_id IS NULL
);
